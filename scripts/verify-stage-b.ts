// Read-only verification of Stage B (provider migration) outcomes.
import { PrismaClient } from "@prisma/client";
import { createHash } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const prisma = new PrismaClient();

interface Result { name: string; expected: string; actual: string; pass: boolean; }
const results: Result[] = [];
function check(name: string, expected: string, actual: string) {
  results.push({ name, expected, actual, pass: actual === expected });
}

async function main() {
  // 1. Provider table exists.
  const providerExists = await prisma.$queryRawUnsafe<Array<{ exists: number }>>(
    `SELECT COUNT(*)::int AS exists FROM information_schema.tables
     WHERE table_schema='public' AND table_name='Provider'`,
  );
  check("Provider table exists", "1", String(providerExists[0]!.exists));

  // 2. Provider table has exactly 2 backfilled providers.
  const providerCount = await prisma.$queryRawUnsafe<Array<{ n: bigint }>>(
    `SELECT COUNT(*)::bigint AS n FROM "Provider"`,
  );
  check("Provider row count", "2", String(providerCount[0]!.n));

  // 3. Provider rows: print them.
  const providers = await prisma.$queryRawUnsafe<Array<{ id: string; slug: string; name: string }>>(
    `SELECT id, slug, name FROM "Provider" ORDER BY slug`,
  );
  for (const p of providers) {
    console.log(`  Provider: id=${p.id}  slug=${p.slug}  name=${p.name}`);
  }

  // 4. Expected backfilled providers: prov_<md5('canteen-a')> and prov_<md5('canteen-b')>.
  // Compute the expected IDs in JS (SHA-256 of a UTF-8 string converted to a hex,
  // but the migration uses PostgreSQL's md5(), which is a different hash. We must
  // re-derive using PostgreSQL so the comparison is byte-identical to the migration).
  const expected = await prisma.$queryRawUnsafe<Array<{ slug: string; digest: string }>>(
    `SELECT 'prov-' || slug AS slug, 'prov_' || md5(slug) AS digest
     FROM (VALUES ('canteen-a'), ('canteen-b')) AS t(slug)`,
  );
  const expectedMap: Record<string, string> = {};
  for (const e of expected) expectedMap[e.slug] = e.digest;
  console.log("  Expected provider IDs:");
  for (const [slug, id] of Object.entries(expectedMap)) {
    console.log(`    ${slug} -> ${id}`);
  }
  for (const p of providers) {
    if (p.id !== expectedMap[p.slug]) {
      results.push({
        name: `Provider ${p.slug} id matches deterministic backfill`,
        expected: expectedMap[p.slug]!,
        actual: p.id,
        pass: false,
      });
    } else {
      results.push({
        name: `Provider ${p.slug} id matches deterministic backfill`,
        expected: expectedMap[p.slug]!,
        actual: p.id,
        pass: true,
      });
    }
  }

  // 5. Each Counter maps to exactly one Provider.
  const mapping = await prisma.$queryRawUnsafe<
    Array<{ counter_slug: string; counter_name: string; provider_slug: string; provider_name: string }>
  >(
    `SELECT c.slug AS counter_slug, c.name AS counter_name,
            p.slug AS provider_slug, p.name AS provider_name
     FROM "Counter" c JOIN "Provider" p ON c."providerId" = p.id
     ORDER BY c.slug`,
  );
  for (const m of mapping) {
    console.log(`  Counter ${m.counter_slug} -> Provider ${m.provider_slug} (${m.provider_name})`);
  }
  check("Counter->Provider mapping row count", "2", String(mapping.length));

  // 6. Both Counter.providerId values are non-null.
  const nullProviders = await prisma.$queryRawUnsafe<Array<{ n: bigint }>>(
    `SELECT COUNT(*)::bigint AS n FROM "Counter" WHERE "providerId" IS NULL`,
  );
  check("Counter rows with NULL providerId", "0", String(nullProviders[0]!.n));

  // 7. Provider FK exists and is valid (i.e. every Counter.providerId points to a real Provider).
  const fkInfo = await prisma.$queryRawUnsafe<Array<{ conname: string; confdeltype: string; confupdtype: string }>>(
    `SELECT conname, confdeltype, confupdtype FROM pg_constraint
     WHERE conname = 'Counter_providerId_fkey'`,
  );
  if (fkInfo.length === 0) {
    check("Counter_providerId_fkey exists", "present", "missing");
  } else {
    const fk = fkInfo[0]!;
    // confdeltype: 'r' = RESTRICT, 'c' = CASCADE, 'n' = SET NULL, 'a' = NO ACTION
    // confupdtype: 'c' = CASCADE (default for prisma non-nullable FKs)
    const expectedDel = "r";
    const expectedUpd = "c";
    check("FK onDelete", expectedDel, fk.confdeltype);
    check("FK onUpdate", expectedUpd, fk.confupdtype);
  }

  // 8. Counter.updatedAt exists, NOT NULL.
  const upd = await prisma.$queryRawUnsafe<Array<{ is_nullable: string; data_type: string; column_default: string | null }>>(
    `SELECT is_nullable, data_type, column_default FROM information_schema.columns
     WHERE table_schema='public' AND table_name='Counter' AND column_name='updatedAt'`,
  );
  if (upd.length === 0) {
    check("Counter.updatedAt exists", "present", "missing");
  } else {
    check("Counter.updatedAt nullable", "NO", upd[0]!.is_nullable);
    check("Counter.updatedAt type", "timestamp without time zone", upd[0]!.data_type);
  }

  // 9. Row counts unchanged from pre-Stage-B baseline.
  const counts = await prisma.$queryRawUnsafe<Array<{ table_name: string; n: bigint }>>(
    `SELECT 'User' AS table_name, COUNT(*)::bigint AS n FROM "User"
     UNION ALL SELECT 'Counter', COUNT(*)::bigint FROM "Counter"
     UNION ALL SELECT 'MenuItem', COUNT(*)::bigint FROM "MenuItem"
     UNION ALL SELECT 'Order', COUNT(*)::bigint FROM "Order"
     UNION ALL SELECT 'OrderItem', COUNT(*)::bigint FROM "OrderItem"
     UNION ALL SELECT 'StaffCounter', COUNT(*)::bigint FROM "StaffCounter"`,
  );
  const expectedCounts: Record<string, string> = {
    User: "7", Counter: "2", MenuItem: "24", Order: "20",
    OrderItem: "31", StaffCounter: "4",
  };
  for (const c of counts) {
    check(`row count ${c.table_name}`, expectedCounts[c.table_name]!, String(c.n));
  }

  // 10. Migration history: Stage A and Stage B both present, both finished.
  const migs = await prisma.$queryRawUnsafe<
    Array<{ migration_name: string; finished_at: Date | null; rolled_back_at: Date | null; applied_steps_count: number; checksum: string }>
  >(
    `SELECT migration_name, finished_at, rolled_back_at, applied_steps_count, checksum
     FROM "_prisma_migrations"
     WHERE migration_name IN ('20261012000000_menu_archive_and_updated_at','20261013000000_provider_introduction')
     ORDER BY started_at`,
  );
  for (const m of migs) {
    check(`${m.migration_name} finished`, "yes", m.finished_at ? "yes" : "no");
    check(`${m.migration_name} rolled_back`, "no", m.rolled_back_at ? "yes" : "no");
    check(`${m.migration_name} applied_steps_count`, "1", String(m.applied_steps_count));
    // Verify checksum matches current file.
    const file = resolve(process.cwd(), "prisma", "migrations", m.migration_name, "migration.sql");
    if (existsSync(file)) {
      const sql = readFileSync(file, "utf8");
      const fileHash = createHash("sha256").update(sql).digest("hex");
      check(`${m.migration_name} checksum match`, fileHash, m.checksum);
    } else {
      check(`${m.migration_name} checksum match`, "file exists", "file missing");
    }
  }
  check("Stage A and Stage B both recorded", "2", String(migs.length));

  // 11. Menu archive still in place (regression check).
  const mi = await prisma.$queryRawUnsafe<Array<{ is_nullable: string; data_type: string }>>(
    `SELECT is_nullable, data_type FROM information_schema.columns
     WHERE table_schema='public' AND table_name='MenuItem'
       AND column_name IN ('archivedAt','updatedAt')`,
  );
  check("MenuItem.archivedAt present", "present", mi.length === 2 ? "present" : "missing");
  // Already verified column properties in db-probe.ts; here we just confirm presence.

  // 12. MenuItem_archivedAt_idx still present.
  const idx = await prisma.$queryRawUnsafe<Array<{ indexname: string }>>(
    `SELECT indexname FROM pg_indexes
     WHERE schemaname='public' AND tablename='MenuItem' AND indexname='MenuItem_archivedAt_idx'`,
  );
  check("MenuItem_archivedAt_idx present", "present", idx.length === 1 ? "present" : "missing");

  // Print results.
  console.log("");
  let pass = 0, fail = 0;
  for (const r of results) {
    if (r.pass) pass++;
    else { fail++; console.log(`  FAIL: ${r.name}  expected=${r.expected}  actual=${r.actual}`); }
  }
  console.log(`\nTotal: ${results.length}  Pass: ${pass}  Fail: ${fail}`);
  process.exit(fail === 0 ? 0 : 1);
}

main()
  .catch((e) => { console.error("FATAL:", e); process.exit(2); })
  .finally(() => prisma.$disconnect());
