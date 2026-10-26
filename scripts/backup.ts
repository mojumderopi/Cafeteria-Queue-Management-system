// Logical backup of the smart_queue database via pg_dump.
//
// SAFETY:
//   * Read-only with respect to application data: pg_dump issues SELECTs
//     and does not write to the database.
//   * DATABASE_URL is parsed into structured key=value args. The
//     password is passed via the PGPASSWORD env var (which is not
//     inherited into child process command lines, only into the env
//     of the spawned process). The password is never logged.
//   * No --clean / --if-exists: the dump is a plain schema+data script.
//   * Verified non-empty and contains CREATE TABLE for every application
//     table. Restore-readiness is NOT exercised here.
//
// USAGE: npx tsx scripts/backup.ts [optional-output-filename]
// EXIT CODES: 2 pg_dump not found, 3 .env missing, 4 pg_dump failed,
//             5 dump file empty, 6 expected tables missing from dump.

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

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
  const userInfo = decodeURIComponent(u.username);
  const password = decodeURIComponent(u.password);
  return {
    host: u.hostname,
    port: u.port || "5432",
    user: userInfo,
    password,
    database: u.pathname.replace(/^\//, ""),
  };
}

function findPgDump(): string {
  const candidates = [
    "C:\\Program Files\\PostgreSQL\\16\\bin\\pg_dump.exe",
    "C:\\Program Files\\PostgreSQL\\15\\bin\\pg_dump.exe",
    "C:\\Program Files\\PostgreSQL\\14\\bin\\pg_dump.exe",
    "/usr/lib/postgresql/16/bin/pg_dump",
    "/usr/bin/pg_dump",
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  const r = spawnSync("pg_dump", ["--version"], { stdio: "ignore" });
  return r.status === 0 ? "pg_dump" : "";
}

function main() {
  const raw = loadDotEnvValue("DATABASE_URL");
  if (!raw) {
    console.error("ERROR: DATABASE_URL is missing from .env");
    process.exit(3);
  }
  const conn = parseDbUrl(raw);
  if (!conn) {
    console.error("ERROR: DATABASE_URL is not a postgresql:// URL");
    process.exit(3);
  }

  const pgDump = findPgDump();
  if (!pgDump) {
    console.error("ERROR: pg_dump not found in standard locations or on PATH");
    process.exit(2);
  }

  const stamp = new Date()
    .toISOString()
    .replace(/[:.]/g, "")
    .replace(/T/, "-")
    .slice(0, 15);
  const outDir = resolve(process.cwd(), "backups");
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
  const outPath = process.argv[2] ?? join(outDir, `pre-migration-${stamp}.sql`);

  console.log(`pg_dump:        ${pgDump}`);
  console.log(`db host:        ${conn.host}`);
  console.log(`db port:        ${conn.port}`);
  console.log(`db user:        ${conn.user}`);
  console.log(`db name:        ${conn.database}`);
  console.log(`db password:    (loaded from .env, not printed)`);
  console.log(`output:         ${outPath}`);
  console.log(`timestamp (UTC): ${new Date().toISOString()}`);

  const r = spawnSync(
    pgDump,
    [
      "--host=" + conn.host,
      "--port=" + conn.port,
      "--username=" + conn.user,
      "--dbname=" + conn.database,
      "--no-owner",
      "--no-acl",
      "--format=plain",
      "--encoding=UTF8",
      "--file=" + outPath,
    ],
    {
      stdio: ["ignore", "inherit", "inherit"],
      env: { ...process.env, PGPASSWORD: conn.password },
    },
  );
  if (r.status !== 0) {
    console.error(`pg_dump exited with code ${r.status ?? "?"}`);
    process.exit(4);
  }

  if (!existsSync(outPath)) {
    console.error(`ERROR: dump file not found at ${outPath}`);
    process.exit(5);
  }
  const size = statSync(outPath).size;
  if (size === 0) {
    console.error(`ERROR: dump file is empty`);
    process.exit(5);
  }
  console.log(`dump size:      ${size} bytes`);

  const expected = ["User", "Counter", "MenuItem", "Order", "OrderItem", "StaffCounter"];
  const text = readFileSync(outPath, "utf8");
  const missing = expected.filter(
    (t) => !text.includes(`CREATE TABLE public."${t}"`),
  );
  if (missing.length > 0) {
    console.error(`ERROR: dump is missing CREATE TABLE for: ${missing.join(", ")}`);
    process.exit(6);
  }
  console.log(`tables verified: ${expected.join(", ")}`);

  const dataChecks: Array<[string, number]> = [
    ["canteen-a", 1],
    ["canteen-b", 1],
    ["Veg Biryani", 1],
  ];
  for (const [needle, minCount] of dataChecks) {
    const count = text.split(needle).length - 1;
    if (count < minCount) {
      console.error(`ERROR: dump is missing expected data "${needle}" (found ${count})`);
      process.exit(6);
    }
  }
  console.log(`data spot-checks passed`);

  console.log(`\nVerify (read-only): the file at ${outPath} is a plain`);
  console.log("schema+data script. Restore-readiness is NOT exercised by");
  console.log("this script. To restore into a clean database for verification:");
  console.log(`  createdb smart_queue_restore && psql -d smart_queue_restore -f "${outPath}"`);

  process.exit(0);
}

main();
