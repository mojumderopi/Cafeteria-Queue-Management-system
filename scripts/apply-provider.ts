// Apply ONLY the 20261013000000_provider_introduction migration against
// the live smart_queue database. This is the controlled, out-of-band
// Prisma procedure: the migration SQL is run inside a transaction and
// the result is recorded in _prisma_migrations with the SHA-256 of the
// file's contents as the checksum. No `prisma migrate deploy` is run.
//
// The migration SQL is idempotent: every step uses IF NOT EXISTS /
// ON CONFLICT DO NOTHING / a pg_constraint guard, so a re-run after a
// partial apply is also safe.

import { spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
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
  for (const c of candidates) if (existsSync(c)) return c;
  const r = spawnSync("psql", ["--version"], { stdio: "ignore" });
  return r.status === 0 ? "psql" : "";
}

function main() {
  const migrationName = "20261013000000_provider_introduction";
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

  // Pre-check: ensure migration not already applied.
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

  // Build the transaction file. cuid-shaped id (matches the existing
  // convention in _prisma_migrations).
  const cuidId =
    "c" + Date.now().toString(36) + randomBytes(12).toString("hex");
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
  writeFileSync(txnPath, txnContent, "utf8");
  console.log(`wrote transaction file: ${txnPath} (${txnContent.length} bytes)`);

  // Apply.
  const apply = spawnSync(
    psql,
    [...psqlArgs, "--file=" + txnPath, "--set", "ON_ERROR_STOP=1"],
    { stdio: ["ignore", "inherit", "inherit"], env },
  );
  if (apply.status !== 0) {
    console.error(`psql apply failed with exit ${apply.status} (transaction rolled back)`);
    process.exit(4);
  }
  console.log("psql apply: exit 0 (committed)");

  // Post-conditions: re-check.
  const postCheck = spawnSync(
    psql,
    [
      ...psqlArgs,
      "--tuples-only",
      "--command=SELECT 'mig' AS t, COUNT(*) FROM \"_prisma_migrations\" WHERE migration_name = '" + migrationName + "' AND checksum = '" + expectedChecksum + "' AND finished_at IS NOT NULL AND rolled_back_at IS NULL AND applied_steps_count = 1 UNION ALL SELECT 'provider_table', COUNT(*) FROM information_schema.tables WHERE table_schema='public' AND table_name='Provider' UNION ALL SELECT 'provider_rows', COUNT(*) FROM \"Provider\" UNION ALL SELECT 'counter_providerId', COUNT(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='Counter' AND column_name='providerId' AND is_nullable='NO' UNION ALL SELECT 'counter_providerId_nn', COUNT(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='Counter' AND column_name='providerId' UNION ALL SELECT 'counter_updatedAt', COUNT(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='Counter' AND column_name='updatedAt' AND is_nullable='NO' UNION ALL SELECT 'fk', COUNT(*) FROM pg_constraint WHERE conname = 'Counter_providerId_fkey' UNION ALL SELECT 'counter_rows', COUNT(*) FROM \"Counter\";",
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
  //   mig | 1                       (_prisma_migrations row for this migration)
  //   provider_table | 1            (Provider table exists)
  //   provider_rows | 2             (2 backfilled providers)
  //   counter_providerId | 1        (1 Counter column, NOT NULL)
  //   counter_providerId_nn | 1     (1 Counter column, exists regardless of nullability)
  //   counter_updatedAt | 1         (1 Counter column, NOT NULL)
  //   fk | 1                        (Counter_providerId_fkey exists)
  //   counter_rows | 2              (2 Counter rows preserved)
  const expect: Record<string, number> = {
    mig: 1,
    provider_table: 1,
    provider_rows: 2,
    counter_providerId: 1,
    counter_providerId_nn: 1,
    counter_updatedAt: 1,
    fk: 1,
    counter_rows: 2,
  };
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

  console.log("\nAPPLIED: 20261013000000_provider_introduction");
  process.exit(0);
}

main();
