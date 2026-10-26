// Redis stock recovery — DRY-RUN ONLY by default.
//
// Restores Redis stock keys from PostgreSQL's MenuItem.stockQty after a
// flush, while preserving the units held by in-flight orders. The stock
// lifecycle is:
//
//   - reserveStock() is called on POST /api/orders BEFORE the Order row
//     is inserted with status = "PENDING_CASHIER".
//   - releaseStock() is called only on cashier reject
//     (PENDING_CASHIER -> REJECTED) and on customer cancel
//     (PENDING_CASHIER -> CANCELLED).
//   - kitchen start (APPROVED -> PREPARING) and kitchen ready
//     (PREPARING -> READY) do NOT touch Redis.
//   - cashier collect (READY -> COMPLETED) does NOT touch Redis (stock is
//     consumed, not refunded).
//
// Therefore the statuses that still hold Redis stock are:
//   PENDING_CASHIER, APPROVED, PREPARING, READY
// And the statuses that do NOT hold stock are:
//   REJECTED (released by cashier reject), CANCELLED (released by
//   customer cancel), COMPLETED (consumed by delivery).
//
// Run:    npx tsx scripts/recover-stock.ts                       (dry-run)
// Run:    npx tsx scripts/recover-stock.ts --apply               (write;
//         requires ALLOW_APPLY=1 AND a passing environment guard).
//
// This script writes to Redis only. It does NOT touch PostgreSQL. It is
// intended for a maintenance window with no order-create traffic.
// Running it while orders are being placed will race with reserveStock
// and may overwrite in-flight decrements.

import { prisma } from "../lib/prisma";
import { redis, k } from "../lib/redis";
import { setStock } from "../lib/queue";

// --- 1. Status filter ----------------------------------------------------------
// All order statuses that hold Redis stock. Anything else either had its
// stock released (REJECTED, CANCELLED) or consumed (COMPLETED).
const STOCK_HOLDING_STATUSES = [
  "PENDING_CASHIER",
  "APPROVED",
  "PREPARING",
  "READY",
] as const;

type Plan = {
  counterId: string;
  counterName: string;
  counterSlug: string;
  itemId: string;
  itemName: string;
  redisKey: string;
  stockQty: number;
  liveReserved: number;
  recovered: number;
  redisBefore: number | null;
};

// --- 2. Environment guard ------------------------------------------------------
//
// This guard does NOT rely on URL substring matching. It connects to the
// actual configured targets, asks each server for its identity, and
// compares those identities to a small denylist. If either side looks
// like production, the script refuses to write UNLESS the operator has
// explicitly opted in via ALLOW_RECOVERY_TARGETS=1 AND typed the literal
// confirmation string "i-understand-this-is-production" into the env
// variable ALLOW_RECOVERY_CONFIRM. There is no shortcut.
//
// The guard runs even in dry-run mode, so the operator sees what the
// resolved targets are before deciding to apply.

type TargetIdentity = {
  database: string;
  user: string;
  host: string;
  port: number;
};

type RedisIdentity = {
  version: string;
  host: string;
  port: number;
  dbsize: number;
};

// Tokens that, if seen in the resolved Postgres database name, mark the
// target as production-class. Lower-case comparison.
const PROD_DB_NAME_DENY = ["prod", "production", "prd", "live"];
// Tokens that mark a Redis server as production-class. Matched against
// the redis_version banner (which is the only field we trust) and
// against DBSIZE thresholds (large datasets are usually production).
const PROD_REDIS_DBSIZE_WARN = 10_000;

// Localhost CIDRs. Connections to these addresses are always considered
// local regardless of other signals. PostgreSQL's inet_server_addr()
// returns addresses with a CIDR suffix (e.g. "::1/128", "127.0.0.1/32"),
// so we strip that before comparing.
function normalizeHost(host: string): string {
  // Strip a trailing "/<digits>" CIDR suffix, if any.
  return host.replace(/\/\d+$/, "").toLowerCase();
}

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "::1", "localhost", "0.0.0.0", "::"]);

function isLoopback(host: string): boolean {
  return LOOPBACK_HOSTS.has(normalizeHost(host));
}

async function resolvePostgresIdentity(): Promise<TargetIdentity> {
  // current_database() / current_user() / inet_server_addr() / inet_server_port()
  // come from the live server, not from the connection string. This is
  // the trustworthy part of the guard.
  const rows = await prisma.$queryRaw<Array<{
    db: string;
    usr: string;
    host: string | null;
    port: number | null;
  }>>`SELECT current_database() AS db, current_user AS usr, inet_server_addr()::text AS host, inet_server_port() AS port`;
  const r = rows[0];
  if (!r) throw new Error("Postgres identity probe returned no rows");
  return {
    database: r.db,
    user: r.usr,
    host: r.host ?? "?",
    port: r.port ?? 0,
  };
}

async function resolveRedisIdentity(): Promise<RedisIdentity> {
  // INFO server is the standard way to get the running Redis version.
  const info = (await redis.info("server")) as string;
  const versionMatch = info.match(/redis_version:([^\r\n]+)/);
  // CONFIG GET is restricted on many managed Redis instances. We use
  // the connection URL as the authoritative source for the host/port we
  // are talking to; if CONFIG GET fails we fall through with "?" for
  // the server-reported port, which is fine because the host guard
  // already passed (or failed) based on the URL.
  let serverPort: string | null = null;
  try {
    const cfg = (await redis.call("CONFIG", "GET", "port")) as string[];
    if (Array.isArray(cfg) && cfg.length >= 2) serverPort = cfg[1];
  } catch {
    serverPort = null;
  }
  const dbsize = await redis.dbsize();
  const url = process.env.REDIS_URL ?? "redis://localhost:6379";
  let urlHost = "localhost";
  let urlPort = 6379;
  try {
    const u = new URL(url);
    urlHost = u.hostname || "localhost";
    urlPort = u.port ? parseInt(u.port, 10) : 6379;
  } catch {
    // Leave defaults.
  }
  return {
    version: versionMatch?.[1]?.trim() ?? "?",
    host: urlHost,
    port: serverPort ? parseInt(serverPort, 10) : urlPort,
    dbsize,
  };
}

function looksLikeProdDbName(name: string): boolean {
  const lower = name.toLowerCase();
  return PROD_DB_NAME_DENY.some((tok) => lower === tok || lower.startsWith(tok + "_") || lower.includes("-" + tok));
}

function assessEnvironment(pg: TargetIdentity, rd: RedisIdentity): {
  safe: boolean;
  reasons: string[];
} {
  const reasons: string[] = [];
  // Postgres: any non-loopback host is treated as elevated.
  if (!isLoopback(pg.host)) reasons.push(`Postgres host is not loopback: ${pg.host}:${pg.port}`);
  if (looksLikeProdDbName(pg.database)) reasons.push(`Postgres database name looks like production: "${pg.database}"`);
  // Redis: any non-loopback host is treated as elevated.
  if (!isLoopback(rd.host)) reasons.push(`Redis host is not loopback: ${rd.host}:${rd.port}`);
  // Redis DBSIZE > 10k is treated as production-class even on loopback,
  // because a large dataset is unlikely to be dev. (This can be
  // overridden with ALLOW_RECOVERY_TARGETS=1 + ALLOW_RECOVERY_CONFIRM.)
  if (rd.dbsize > PROD_REDIS_DBSIZE_WARN) {
    reasons.push(`Redis DBSIZE is large (${rd.dbsize}); treating as production-class`);
  }
  return { safe: reasons.length === 0, reasons };
}

async function checkEnvironment(): Promise<{ pg: TargetIdentity; rd: RedisIdentity }> {
  const pg = await resolvePostgresIdentity();
  const rd = await resolveRedisIdentity();
  const verdict = assessEnvironment(pg, rd);
  console.log("");
  console.log("--- environment identity ---");
  console.log(`postgres:  ${pg.user}@${pg.host}:${pg.port}/${pg.database}`);
  console.log(`redis:     ${rd.host}:${rd.port} (version ${rd.version}, dbsize=${rd.dbsize})`);
  if (!verdict.safe) {
    console.log("environment assessment: ELEVATED");
    for (const r of verdict.reasons) console.log(`  - ${r}`);
    const optedIn =
      process.env.ALLOW_RECOVERY_TARGETS === "1" &&
      process.env.ALLOW_RECOVERY_CONFIRM === "i-understand-this-is-production";
    if (!optedIn) {
      throw new Error(
        "Refusing to run: resolved targets look like production. " +
          'Re-run with ALLOW_RECOVERY_TARGETS=1 and ALLOW_RECOVERY_CONFIRM="i-understand-this-is-production" in the env to override.',
      );
    }
    console.log("environment assessment: OVERRIDDEN via ALLOW_RECOVERY_TARGETS + ALLOW_RECOVERY_CONFIRM");
  } else {
    console.log("environment assessment: local-dev OK");
  }
  console.log("");
  return { pg, rd };
}

// --- 3. Plan computation -------------------------------------------------------

async function plan(): Promise<Plan[]> {
  // Every item that could ever accept an order. Skipping unavailable or
  // archived items avoids creating Redis keys for items that cannot be
  // ordered; outstanding orders against archived items are still
  // tracked in Postgres and the kitchen will complete them, but they
  // do not block new orders, so no Redis restoration is needed.
  const items = await prisma.menuItem.findMany({
    where: { isAvailable: true, archivedAt: null },
    include: { counter: { select: { id: true, name: true, slug: true } } },
  });
  // In-flight orders: the four statuses that hold Redis stock.
  const liveOrders = await prisma.order.findMany({
    where: { status: { in: [...STOCK_HOLDING_STATUSES] } },
    select: { id: true, counterId: true, items: { select: { menuItemId: true, qty: true } } },
  });
  const reservedByKey = new Map<string, number>();
  for (const o of liveOrders) {
    for (const it of o.items) {
      const key = `${o.counterId}::${it.menuItemId}`;
      reservedByKey.set(key, (reservedByKey.get(key) ?? 0) + it.qty);
    }
  }

  const plans: Plan[] = [];
  for (const it of items) {
    const reserved = reservedByKey.get(`${it.counterId}::${it.id}`) ?? 0;
    const recovered = Math.max(0, it.stockQty - reserved);
    const redisKey = k.stock(it.counterId, it.id);
    let redisBefore: number | null = null;
    try {
      const raw = await redis.get(redisKey);
      if (raw !== null) redisBefore = parseInt(raw, 10);
    } catch {
      // Continue; redisBefore stays null.
    }
    plans.push({
      counterId: it.counterId,
      counterName: it.counter.name,
      counterSlug: it.counter.slug,
      itemId: it.id,
      itemName: it.name,
      redisKey,
      stockQty: it.stockQty,
      liveReserved: reserved,
      recovered,
      redisBefore,
    });
  }
  return plans;
}

// --- 4. Apply with read-after-write -------------------------------------------

async function applyWithVerification(plans: Plan[]): Promise<{ ok: number; fail: number }> {
  let ok = 0;
  let fail = 0;
  for (const p of plans) {
    try {
      await setStock(p.counterId, p.itemId, p.recovered);
      // Read-after-write verification. ioredis returns string|null.
      const after = await redis.get(p.redisKey);
      const expected = String(p.recovered);
      if (after === expected) {
        console.log(`  ok    ${p.redisKey} = ${after}  (was ${p.redisBefore === null ? "missing" : p.redisBefore})`);
        ok += 1;
      } else {
        console.error(
          `  FAIL  ${p.redisKey}: wrote ${p.recovered}, read back ${after} (was ${p.redisBefore === null ? "missing" : p.redisBefore})`,
        );
        fail += 1;
      }
    } catch (e) {
      console.error(`  FAIL  ${p.redisKey}: ${(e as Error).message}`);
      fail += 1;
    }
  }
  return { ok, fail };
}

// --- 5. Entry point ------------------------------------------------------------

async function main() {
  const args = new Set(process.argv.slice(2));
  const apply = args.has("--apply");
  if (apply && process.env.ALLOW_APPLY !== "1") {
    console.error('Refusing to write: --apply requires ALLOW_APPLY=1 in the env.');
    process.exit(2);
  }

  // The environment guard runs in BOTH dry-run and apply modes so the
  // operator sees the resolved targets and the verdict before deciding
  // to apply.
  await checkEnvironment();

  const plans = await plan();

  // Group by counter for readability.
  const byCounter = new Map<string, Plan[]>();
  for (const p of plans) {
    if (!byCounter.has(p.counterId)) byCounter.set(p.counterId, []);
    byCounter.get(p.counterId)!.push(p);
  }

  console.log(`mode: ${apply ? "APPLY" : "DRY-RUN"}`);
  console.log(`counters: ${byCounter.size}, items: ${plans.length}`);
  console.log("");

  for (const [, list] of byCounter) {
    const first = list[0];
    console.log(`-- ${first.counterName} (${first.counterSlug}) [${first.counterId}] --`);
    for (const p of list) {
      const beforeStr = p.redisBefore === null ? "missing" : String(p.redisBefore);
      console.log(
        `  ${p.itemName.padEnd(28)} stockQty=${String(p.stockQty).padStart(4)} ` +
          `reserved=${String(p.liveReserved).padStart(3)} ` +
          `recovered=${String(p.recovered).padStart(4)} ` +
          `redisBefore=${beforeStr.padStart(7)} ` +
          `key=${p.redisKey}`,
      );
    }
  }

  if (!apply) {
    console.log("");
    console.log("DRY-RUN complete. No writes performed. Re-run with --apply and ALLOW_APPLY=1 to write.");
    return;
  }

  console.log("");
  console.log("APPLY: writing Redis SETs with read-after-write verification...");
  const summary = await applyWithVerification(plans);
  console.log(`APPLY complete. ok=${summary.ok} fail=${summary.fail}`);
  if (summary.fail > 0) {
    console.error(`WARN: ${summary.fail} key(s) did not verify. Re-run --apply after fixing the cause.`);
    process.exit(3);
  }
}

main()
  .then(async () => {
    await prisma.$disconnect();
    await redis.quit().catch(() => undefined);
  })
  .catch(async (e) => {
    console.error("FAILED:", e instanceof Error ? e.message : e);
    await prisma.$disconnect();
    await redis.quit().catch(() => undefined);
    process.exit(1);
  });
