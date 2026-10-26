// Thin wrappers around the Lua scripts. Keeps callers from poking at Redis directly.
//
// ## Cross-system consistency model
//
// The application uses two coordinated stores: PostgreSQL (durable,
// authoritative for menu items, orders, users, providers, counters) and
// Redis (authoritative for the live stock counter and the priority
// queue). There is no distributed transaction that spans both, so the
// system relies on the following invariants:
//
//   1. Stock reservation is a Redis-only write that happens BEFORE the
//      PostgreSQL order insert. If the DB insert fails, the caller MUST
//      release the reservation (see app/api/orders/route.ts).
//   2. Stock release on cashier reject or customer cancel is a
//      Redis-only write. The status transition is a conditional Prisma
//      update (see Phase 2.5 atomicity fix).
//   3. Stock consumption on order collect is implicit; the stock was
//      reserved at order creation and is not refunded.
//   4. The priority score is written in two places: the original
//      Date.now() at order creation, and bumped values in the promoter.
//      The Promoter updates both the Redis ZSET and the PostgreSQL
//      Order.priorityScore so the staff views reflect anti-starvation.
//   5. Recovery: if Redis is flushed or out of sync, the idempotent
//      scripts/recover-stock.ts rebuilds stock keys from
//      MenuItem.stockQty minus the in-flight reservations
//      (PENDING_CASHIER, APPROVED, PREPARING, READY).

import { redis, k } from "./redis";
import { luaScripts, luaShas } from "./lua/scripts";

let loaded = false;

async function ensureLoaded() {
  if (loaded) return;
  for (const key of Object.keys(luaScripts) as (keyof typeof luaScripts)[]) {
    const sha = await redis.script("LOAD", luaScripts[key]) as string;
    luaShas[key] = sha;
  }
  loaded = true;
}

async function callLua<T = unknown>(name: keyof typeof luaScripts, keys: string[], args: (string | number)[]): Promise<T> {
  await ensureLoaded();
  const sha = luaShas[name];
  try {
    const res = await redis.evalsha(sha, keys.length, ...keys, ...args);
    return res as T;
  } catch (err) {
    // Redis returns NOSCRIPT if flushed — reload and retry once.
    const msg = (err as Error).message ?? "";
    if (msg.includes("NOSCRIPT")) {
      loaded = false;
      await ensureLoaded();
      const res = await redis.evalsha(luaShas[name], keys.length, ...keys, ...args);
      return res as T;
    }
    throw err;
  }
}

export type ReserveOk = [1, ...number[]]; // [1, remaining1, remaining2, ...]
export type ReserveFail = [0, number]; // [0, shortIndex]

export async function reserveStock(
  counterId: string,
  lines: { menuItemId: string; qty: number }[],
): Promise<{ ok: true; remaining: number[] } | { ok: false; shortIndex: number }> {
  const keys = lines.map((l) => k.stock(counterId, l.menuItemId));
  const args = lines.map((l) => l.qty);
  const res = (await callLua("reserveStock", keys, args)) as ReserveOk | ReserveFail;
  if (res[0] === 1) {
    return { ok: true, remaining: res.slice(1) as number[] };
  }
  // The Lua script is 1-based (it iterates `for i = 1, n`), but
  // JavaScript consumers expect 0-based indexes into the `lines`
  // array. Convert at the boundary so the API is consistent.
  return { ok: false, shortIndex: res[1] - 1 };
}

export async function releaseStock(
  counterId: string,
  lines: { menuItemId: string; qty: number }[],
): Promise<number[]> {
  const keys = lines.map((l) => k.stock(counterId, l.menuItemId));
  const args = lines.map((l) => l.qty);
  return (await callLua("releaseStock", keys, args)) as number[];
}

export async function enqueueOrder(counterId: string, orderId: string, score: number): Promise<void> {
  await callLua("enqueue", [k.queue(counterId), k.priority(counterId)], [orderId, score]);
}

export async function dequeueOrder(counterId: string, orderId: string): Promise<void> {
  // count=1 removes at most one match. Combined with the idempotent enqueue.lua,
  // this guarantees we never silently drop an unrelated order from the queue.
  await redis.lrem(k.queue(counterId), 1, orderId);
  await redis.zrem(k.priority(counterId), orderId);
}

export async function promoteOldOrders(counterId: string): Promise<string[]> {
  const now = Date.now();
  const ageMs = 90_000; // anything waiting > 90s
  const boost = 50; // bigger than typical new-order score drift
  return (await callLua("promote", [k.priority(counterId)], [now, ageMs, boost])) as string[];
}

export async function listQueuedOrderIds(counterId: string): Promise<string[]> {
  // Reverse so newest is first; kitchen UI uses createdAt for tiebreak.
  return (await redis.lrange(k.queue(counterId), 0, -1)) as string[];
}

export async function nextToken(counterId: string): Promise<string> {
  const n = await redis.incr(k.ticketCounter(counterId));
  const letter = String.fromCharCode(65 + ((n - 1) % 26));
  return `${letter}-${n.toString().padStart(3, "0")}`;
}

// --- Standalone stock helpers (not part of the Lua scripts) -------------------
// These read or write single stock keys directly. They are intentionally
// outside the atomic Lua scripts so the admin restock path and the
// idempotent recovery script can both write the new value and emit the
// realtime event without contending with the reserve / release scripts.

export async function getStock(counterId: string, menuItemId: string): Promise<number> {
  const raw = await redis.get(k.stock(counterId, menuItemId));
  if (raw === null) return 0;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) ? n : 0;
}

export async function getStocks(
  counterId: string,
  menuItemIds: string[],
): Promise<Record<string, number>> {
  if (menuItemIds.length === 0) return {};
  const keys = menuItemIds.map((id) => k.stock(counterId, id));
  const values = (await redis.mget(...keys)) as Array<string | null>;
  const out: Record<string, number> = {};
  for (let i = 0; i < menuItemIds.length; i++) {
    const v = values[i];
    const n = v === null ? 0 : parseInt(v, 10);
    out[menuItemIds[i]] = Number.isFinite(n) ? n : 0;
  }
  return out;
}

// setStock overwrites the stock key with an absolute value. Used by the
// admin restock route and by the idempotent recovery script. The value
// is floored to a non-negative integer; an exception is thrown on
// invalid input so callers fail loudly.
export async function setStock(
  counterId: string,
  menuItemId: string,
  qty: number,
): Promise<number> {
  if (!Number.isFinite(qty)) {
    throw new Error(`setStock: qty must be a finite number (got ${qty})`);
  }
  const value = Math.max(0, Math.floor(qty));
  await redis.set(k.stock(counterId, menuItemId), String(value));
  return value;
}

// setStockFromDb is the bulk variant. Used by the seed script and the
// provider / archive migrations. Each line's stockQty is floored to a
// non-negative integer.
export async function setStockFromDb(
  counterId: string,
  items: { menuItemId: string; stockQty: number }[],
): Promise<void> {
  if (items.length === 0) return;
  const pipe = redis.pipeline();
  for (const it of items) {
    const value = Math.max(0, Math.floor(it.stockQty));
    pipe.set(k.stock(counterId, it.menuItemId), String(value));
  }
  await pipe.exec();
}
