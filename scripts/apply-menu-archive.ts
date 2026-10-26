// Apply ONLY the 20261012000000_menu_archive_and_updated_at migration
// against the live smart_queue database.
//
// This is a controlled, documented procedure for applying a single
// pending Prisma migration out-of-band (Prisma supports this; the
// docs note that DBAs may apply migrations by hand and then record
// the result in _prisma_migrations). The provider migration
// (20261013000000_provider_introduction) is intentionally NOT applied
// here — it remains pending and will be applied in a separate stage.
//
// Steps:
//   1. Begin a transaction.
//   2. Run the 3 SQL statements from the migration file.
//   3. INSERT a row into _prisma_migrations with the SHA-256 of the
//      file contents as the checksum (so the next `migrate status` is
//      consistent).
//   4. Commit.
//
// EXIT CODES:
//   0  success
//   2  migration file missing
//   3  .env missing
//   4  transaction failed (rolled back)
//   5  post-conditions not met (rolled back)

import { spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

interface DbConn {
  host: string;
  port: string;
  user: string;
  password: string;
  database: string;
}

function loadDotEnvValue(key: string): string | null {
  const path = resolve(process.cwd(), ".env");
  if (!existsSync(path)) return null;
  const lines = readFileSync(path, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*"?([^"]*)"?\s*$/i);
    if (m && m[1] === key) return m[2];
  }
  return null;
}

function parseDbUrl(raw: string): DbConn | null {
  let u: URL;
  try { u = new URL(raw); } catch { return null; }
  if (u.protocol !== "postgresql:" && u.protocol !== "postgres:") return null;
  return {
    host: u.hostname,
    port: u.port || "5432",
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
    database: u.pathname.replace(/^\//, ""),
  };
}

function findPsql(): string {
  const candidates = [
    "C:\\Program Files\\PostgreSQL\\16\\bin\\psql.exe",
    "C:\\Program Files\\PostgreSQL\\15\\bin\\psql.exe",
    "C:\\Program Files\\PostgreSQL\\14\\bin\\psql.exe",
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  const r = spawnSync("psql", ["--version"], { stdio: "ignore" });
  return r.status === 0 ? "psql" : "";
}

function main() {
  const migrationName = "20261012000000_menu_archive_and_updated_at";
  const migrationPath = resolve(
    process.cwd(),
    "prisma",
    "migrations",
    migrationName,
    "migration.sql",
  );
  if (!existsSync(migrationPath)) {
    console.error(`ERROR: migration file missing at ${migrationPath}`);
    process.exit(2);
  }
  const migrationSql = readFileSync(migrationPath, "utf8");
  const expectedChecksum = createHash("sha256").update(migrationSql).digest("hex");
  console.log(`migration:    ${migrationName}`);
  console.log(`expected SHA-256 checksum: ${expectedChecksum}`);

  const raw = loadDotEnvValue("DATABASE_URL");
  if (!raw) {
    console.error("ERROR: DATABASE_URL missing from .env");
    process.exit(3);
  }
  const conn = parseDbUrl(raw);
  if (!conn) {
    console.error("ERROR: DATABASE_URL is not a postgresql:// URL");
    process.exit(3);
  }
  const psql = findPsql();
  if (!psql) {
    console.error("ERROR: psql not found in standard locations or on PATH");
    process.exit(2);
  }

  const env = { ...process.env, PGPASSWORD: conn.password };
  const psqlArgs = [
    "--host=" + conn.host,
    "--port=" + conn.port,
    "--username=" + conn.user,
    "--dbname=" + conn.database,
    "--no-psqlrc",
    "--quiet",
  ];

  // Pre-flight: confirm the migration is not already applied. If a row
  // with this migration_name exists, abort.
  const preCheck = spawnSync(
    psql,
    [
      ...psqlArgs,
      "--tuples-only",
      "--command=SELECT 1 FROM \"_prisma_migrations\" WHERE migration_name = '" + migrationName + "';",
    ],
    { stdio: ["ignore", "pipe", "pipe"], env },
  );
  if (preCheck.status !== 0) {
    console.error(`pre-check failed: ${preCheck.stderr?.toString() ?? ""}`);
    process.exit(4);
  }
  const preOut = preCheck.stdout?.toString().trim() ?? "";
  if (preOut.includes("1")) {
    console.error(`ERROR: migration ${migrationName} is already recorded as applied`);
    process.exit(4);
  }
  console.log("pre-check: migration not yet applied (good)");

  // Build a single transaction: BEGIN; <migration SQL>; INSERT into
  // _prisma_migrations; COMMIT;.
  // Strip the leading comment lines from the migration file when
  // embedding it into a single SQL string — comments are fine inside
  // psql -c, but we use -f so we keep them. The simplest robust path
  // is to write the migration SQL to a temp file alongside the INSERT
  // and pass the whole file with psql -v ON_ERROR_STOP=1 inside a
  // transaction.
  // The id column is `text` (no cuid-validated type), so a unique
  // string is sufficient. We use a cuid-shaped id: `c<timestamp-base36>
  // <24 random hex>`. The first two existing migration rows in
  // _prisma_migrations are cuid-shaped; this preserves the convention.
  const cuidId =
    "c" +
    Date.now().toString(36) +
    randomBytes(12).toString("hex");
  const insertRow = `
INSERT INTO "_prisma_migrations" (
    "id", "checksum", "migration_name", "finished_at",
    "applied_steps_count", "started_at"
) VALUES (
    '${cuidId}'::text,
    '${expectedChecksum}',
    '${migrationName}',
    NOW(),
    1,
    NOW()
);
`.trim();

  const txnPath = resolve(process.cwd(), "backups", `apply-${migrationName}.txn.sql`);
  const txnContent = "BEGIN;\n\n" + migrationSql + "\n\n" + insertRow + "\n\nCOMMIT;\n";
  // Use a sync write since this is a small file and we want a known
  // on-disk state before invoking psql.
  require("node:fs").writeFileSync(txnPath, txnContent, "utf8");
  console.log(`wrote transaction file: ${txnPath}`);

  // Apply the transaction.
  const apply = spawnSync(
    psql,
    [...psqlArgs, "--file=" + txnPath, "--set", "ON_ERROR_STOP=1"],
    { stdio: ["ignore", "inherit", "inherit"], env },
  );
  if (apply.status !== 0) {
    console.error(`psql apply failed with exit ${apply.status} (transaction rolled back)`);
    // The transaction file remains on disk for post-mortem.
    process.exit(4);
  }
  console.log("psql apply: exit 0 (committed)");

  // Post-conditions: re-check.
  const postCheck = spawnSync(
    psql,
    [
      ...psqlArgs,
      "--tuples-only",
      "--command=SELECT 'mig' AS t, COUNT(*) FROM \"_prisma_migrations\" WHERE migration_name = '" + migrationName + "' AND checksum = '" + expectedChecksum + "' AND finished_at IS NOT NULL AND rolled_back_at IS NULL AND applied_steps_count = 1 UNION ALL SELECT 'col_arch', COUNT(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='MenuItem' AND column_name='archivedAt' UNION ALL SELECT 'col_upd', COUNT(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='MenuItem' AND column_name='updatedAt' UNION ALL SELECT 'idx', COUNT(*) FROM pg_indexes WHERE schemaname='public' AND tablename='MenuItem' AND indexname='MenuItem_archivedAt_idx' UNION ALL SELECT 'rows', COUNT(*) FROM \"MenuItem\";",
    ],
    { stdio: ["ignore", "pipe", "pipe"], env },
  );
  if (postCheck.status !== 0) {
    console.error(`post-check failed: ${postCheck.stderr?.toString() ?? ""}`);
    process.exit(5);
  }
  console.log("post-check rows:");
  const postOut = postCheck.stdout?.toString().trim() ?? "";
  for (const line of postOut.split(/\r?\n/)) {
    if (line.trim()) console.log("  " + line.trim());
  }
  // Expect:
  //   mig | 1
  //   col_arch | 1
  //   col_upd | 1
  //   idx | 1
  //   rows | 24
  const expect: Record<string, number> = { mig: 1, col_arch: 1, col_upd: 1, idx: 1, rows: 24 };
  let mismatch = false;
  for (const [k, v] of Object.entries(expect)) {
    const re = new RegExp(`^\\s*${k}\\s*\\|\\s*${v}\\s*$`, "m");
    if (!re.test(postOut)) {
      console.error(`  MISMATCH: expected ${k} | ${v}`);
      mismatch = true;
    }
  }
  if (mismatch) {
    console.error("post-conditions not met — investigate before declaring success");
    process.exit(5);
  }

  console.log("\nAPPLIED: 20261012000000_menu_archive_and_updated_at");
  process.exit(0);
}

main();
