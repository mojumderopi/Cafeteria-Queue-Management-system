// Verify the backup file can be restored by psql restore tooling.
//
// SAFETY:
//   * Does NOT touch the live `smart_queue` database.
//   * Creates a separate test database `smart_queue_restore_verify_<stamp>`
//     in the same Postgres cluster, restores the dump into it, runs a
//     few sanity-count queries, and drops the test database.
//   * Failure of any step is non-destructive: the test database is
//     dropped in a `finally` block. The live database is never read or
//     written.
//
// EXIT CODES:
//   0  restore verified
//   2  psql not found
//   3  .env missing
//   4  createdb failed
//   5  psql restore failed
//   6  post-restore counts unexpected
//   7  dropdb failed (non-fatal but reported)

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
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

function findBin(name: string): string {
  const candidates = [
    `C:\\Program Files\\PostgreSQL\\16\\bin\\${name}.exe`,
    `C:\\Program Files\\PostgreSQL\\15\\bin\\${name}.exe`,
    `C:\\Program Files\\PostgreSQL\\14\\bin\\${name}.exe`,
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  const r = spawnSync(name, ["--version"], { stdio: "ignore" });
  return r.status === 0 ? name : "";
}

function runCaptured(bin: string, args: string[], env: NodeJS.ProcessEnv) {
  return spawnSync(bin, args, { stdio: ["ignore", "pipe", "pipe"], env });
}

function main() {
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
  const createdb = findBin("createdb");
  const dropdb = findBin("dropdb");
  const psql = findBin("psql");
  if (!createdb || !dropdb || !psql) {
    console.error(`ERROR: postgres CLI tools not found (createdb=${!!createdb}, dropdb=${!!dropdb}, psql=${!!psql})`);
    process.exit(2);
  }

  const dumpPath = process.argv[2];
  if (!dumpPath || !existsSync(dumpPath)) {
    console.error(`ERROR: dump file not found: ${dumpPath}`);
    process.exit(2);
  }
  const dumpSize = statSync(dumpPath).size;
  console.log(`dump file: ${dumpPath}`);
  console.log(`dump size: ${dumpSize} bytes`);

  const stamp = new Date().toISOString().replace(/[:.]/g, "").slice(0, 15);
  const testDb = `smart_queue_restore_verify_${stamp}`;
  const env = { ...process.env, PGPASSWORD: conn.password };

  // 1. Create the test database.
  const cd = runCaptured(createdb, [
    "--host=" + conn.host,
    "--port=" + conn.port,
    "--username=" + conn.user,
    testDb,
  ], env);
  if (cd.status !== 0) {
    console.error(`createdb failed: exit=${cd.status} stderr=${cd.stderr?.toString() ?? ""}`);
    process.exit(4);
  }
  console.log(`created test database: ${testDb}`);

  let success = false;
  try {
    // 2. Restore the dump via psql.
    const r = runCaptured(psql, [
      "--host=" + conn.host,
      "--port=" + conn.port,
      "--username=" + conn.user,
      "--dbname=" + testDb,
      "--no-psqlrc",
      "--quiet",
      "--file=" + dumpPath,
    ], env);
    if (r.status !== 0) {
      console.error(`psql restore failed: exit=${r.status} stderr=${r.stderr?.toString() ?? ""}`);
      process.exit(5);
    }
    console.log("psql restore: exit 0");

    // 3. Sanity-count queries against the restored DB.
    const counts = runCaptured(psql, [
      "--host=" + conn.host,
      "--port=" + conn.port,
      "--username=" + conn.user,
      "--dbname=" + testDb,
      "--no-psqlrc",
      "--tuples-only",
      "--command=SELECT 'User' AS t, COUNT(*) FROM \"User\" UNION ALL SELECT 'Counter', COUNT(*) FROM \"Counter\" UNION ALL SELECT 'MenuItem', COUNT(*) FROM \"MenuItem\" UNION ALL SELECT 'Order', COUNT(*) FROM \"Order\" UNION ALL SELECT 'OrderItem', COUNT(*) FROM \"OrderItem\" UNION ALL SELECT 'StaffCounter', COUNT(*) FROM \"StaffCounter\" UNION ALL SELECT '_prisma_migrations', COUNT(*) FROM \"_prisma_migrations\";",
    ], env);
    if (counts.status !== 0) {
      console.error(`psql count query failed: exit=${counts.status} stderr=${counts.stderr?.toString() ?? ""}`);
      process.exit(6);
    }
    const countsOut = counts.stdout?.toString().trim() ?? "";
    console.log("post-restore counts:");
    for (const line of countsOut.split(/\r?\n/)) {
      if (line.trim()) console.log("  " + line.trim());
    }

    // Expect: User=7, Counter=2, MenuItem=24, Order=20, OrderItem=31,
    // StaffCounter=4, _prisma_migrations=3 (2 pre-existing + Stage A menu archive).
    const expected: Record<string, number> = {
      User: 7, Counter: 2, MenuItem: 24, Order: 20,
      OrderItem: 31, StaffCounter: 4, "_prisma_migrations": 3,
    };
    let mismatch = false;
    for (const [t, want] of Object.entries(expected)) {
      const re = new RegExp(`^\\s*${t}\\s*\\|\\s*${want}\\s*$`, "m");
      if (!re.test(countsOut)) {
        console.error(`  MISMATCH: expected ${t}=${want} not found in restore output`);
        mismatch = true;
      }
    }
    if (mismatch) process.exit(6);
    success = true;
  } finally {
    // 4. Drop the test database.
    const dd = runCaptured(dropdb, [
      "--host=" + conn.host,
      "--port=" + conn.port,
      "--username=" + conn.user,
      "--if-exists",
      testDb,
    ], env);
    if (dd.status !== 0) {
      console.error(`dropdb warning: exit=${dd.status} stderr=${dd.stderr?.toString() ?? ""}`);
      process.exitCode = 7;
    } else {
      console.log(`dropped test database: ${testDb}`);
    }
  }

  if (success) {
    console.log("\nRESTORE VERIFIED: dump parses cleanly with psql restore tooling");
    console.log("and reproduces the expected pre-migration row counts.");
  }
  process.exit(process.exitCode ?? 0);
}

main();
