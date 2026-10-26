// One-time setup for the isolated test environment.
// Creates a separate Postgres database ("smart_queue_test") and uses
// Redis db 15. Applies the schema (no destructive data: only the test
// DB rows we create are touched).
//
// This script is idempotent. It does NOT touch the dev database
// (smart_queue) or the default Redis db (0).

import { execSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";
import Redis from "ioredis";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const TEST_DB = "smart_queue_test";
const TEST_REDIS_DB = 15;

const devUrl = process.env.DATABASE_URL ?? "";
if (!devUrl) {
  console.error("DATABASE_URL not set");
  process.exit(1);
}

function urlToDb(url: string): string {
  const m = /\/([^/?]+)(\?.*)?$/.exec(url);
  return m ? m[1] : "";
}
const devDb = urlToDb(devUrl);
if (!devDb) {
  console.error("could not parse db from DATABASE_URL");
  process.exit(1);
}
function urlWithDb(url: string, db: string): string {
  return url.replace(/\/[^/?]+(\?.*)?$/, `/${db}$1`);
}

async function main() {
  // --- Postgres: create the test db if needed ---
  const admin = new PrismaClient({
    datasources: { db: { url: urlWithDb(devUrl, "postgres") } },
  });
  try {
    const existing = await admin.$queryRawUnsafe<Array<{ datname: string }>>(
      `SELECT datname FROM pg_database WHERE datname = $1`,
      TEST_DB,
    );
    if (existing.length === 0) {
      await admin.$executeRawUnsafe(`CREATE DATABASE "${TEST_DB}"`);
      console.log(`[testdb] created ${TEST_DB}`);
    } else {
      console.log(`[testdb] ${TEST_DB} already exists; leaving in place`);
    }
  } finally {
    await admin.$disconnect();
  }

  // --- Postgres: apply schema to the test db ---
  // `prisma db push` is the cleanest way to materialize the current
  // schema into a fresh database without running through the full
  // migration history. We deliberately use --skip-generate to keep the
  // main @prisma/client in sync.
  console.log(`[testdb] applying schema to ${TEST_DB}...`);
  const testUrl = urlWithDb(devUrl, TEST_DB);
  execSync(
    `npx prisma db push --skip-generate --accept-data-loss`,
    {
      env: { ...process.env, DATABASE_URL: testUrl },
      stdio: "inherit",
    },
  );
  console.log(`[testdb] schema applied`);

  // --- Redis: pick db 15 and confirm it's reachable ---
  const redis = new Redis(process.env.REDIS_URL ?? "redis://127.0.0.1:6379", {
    db: TEST_REDIS_DB,
    lazyConnect: true,
  });
  try {
    await redis.connect();
    await redis.ping();
    console.log(`[testdb] Redis db ${TEST_REDIS_DB} reachable`);
  } finally {
    await redis.quit().catch(() => undefined);
  }

  // --- Print the env vars integration tests should use ---
  const testRedisUrl = (process.env.REDIS_URL ?? "redis://127.0.0.1:6379").replace(
    /\/(\d+)(\?.*)?$/,
    (_m, _p, qs) => `/${TEST_REDIS_DB}${qs ?? ""}`,
  );
  console.log("");
  console.log("Test environment ready.");
  console.log("Set these in the test runner or via env override:");
  console.log(`  DATABASE_URL=${testUrl}`);
  console.log(`  REDIS_URL=${testRedisUrl}`);
  console.log("");
  console.log("Default dev targets are NOT touched.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
