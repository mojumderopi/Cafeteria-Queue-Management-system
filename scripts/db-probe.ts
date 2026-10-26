// READ-ONLY probe. Defensive: catches relation-not-found errors per
// query so the absence of the Provider table is reported, not raised.
import { PrismaClient, Prisma } from "@prisma/client";

const prisma = new PrismaClient();

async function safe<T>(label: string, fn: () => Promise<T>): Promise<T | { error: string }> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError) {
      return { error: `${label}: ${e.meta?.code ?? "?"} ${e.meta?.message ?? e.message}` };
    }
    if (e instanceof Error) return { error: `${label}: ${e.message}` };
    return { error: `${label}: unknown error` };
  }
}

async function main() {
  const rows = await prisma.$queryRawUnsafe<
    Array<{
      migration_name: string;
      finished_at: Date | null;
      applied_steps_count: number;
      started_at: Date;
      rolled_back_at: Date | null;
    }>
  >(
    `SELECT migration_name, finished_at, applied_steps_count,
            started_at, rolled_back_at
     FROM "_prisma_migrations"
     ORDER BY started_at`,
  );
  console.log("=== _prisma_migrations ===");
  for (const r of rows) {
    console.log(
      `  - ${r.migration_name} (finished=${r.finished_at ? "yes" : "no"}, rolled_back=${r.rolled_back_at ? "yes" : "no"}, steps=${r.applied_steps_count})`,
    );
  }

  const counts = await safe("counts", () =>
    prisma.$queryRawUnsafe<Array<{ table_name: string; n: bigint }>>(
      `SELECT 'User' as table_name, COUNT(*)::bigint as n FROM "User"
       UNION ALL SELECT 'Counter', COUNT(*)::bigint FROM "Counter"
       UNION ALL SELECT 'MenuItem', COUNT(*)::bigint FROM "MenuItem"
       UNION ALL SELECT 'Order', COUNT(*)::bigint FROM "Order"
       UNION ALL SELECT 'OrderItem', COUNT(*)::bigint FROM "OrderItem"
       UNION ALL SELECT 'StaffCounter', COUNT(*)::bigint FROM "StaffCounter"`,
    ),
  );
  console.log("\n=== row counts (existing tables) ===");
  if (Array.isArray(counts)) {
    for (const c of counts) console.log(`  ${c.table_name}: ${c.n}`);
  } else {
    console.log(`  ${counts.error}`);
  }

  const counters = await safe("counters", () =>
    prisma.$queryRawUnsafe<Array<{ id: string; slug: string; name: string }>>(
      `SELECT id, slug, name FROM "Counter" ORDER BY slug`,
    ),
  );
  console.log("\n=== Counter rows ===");
  if (Array.isArray(counters)) {
    if (counters.length === 0) console.log("  (none)");
    for (const c of counters) console.log(`  ${c.slug}  id=${c.id}  name="${c.name}"`);
  } else {
    console.log(`  ${counters.error}`);
  }

  const mi = await safe("menuitem cols", () =>
    prisma.$queryRawUnsafe<Array<{ column_name: string; is_nullable: string; data_type: string; column_default: string | null }>>(
      `SELECT column_name, is_nullable, data_type, column_default
       FROM information_schema.columns
       WHERE table_schema='public' AND table_name='MenuItem'
         AND column_name IN ('archivedAt','updatedAt')`,
    ),
  );
  console.log("\n=== MenuItem pending columns ===");
  if (Array.isArray(mi)) {
    if (mi.length === 0) console.log("  (none of the pending columns exist yet)");
    for (const c of mi) console.log(`  ${c.column_name} ${c.data_type} nullable=${c.is_nullable} default=${c.column_default}`);
  } else {
    console.log(`  ${mi.error}`);
  }

  const miIdx = await safe("menuitem idx", () =>
    prisma.$queryRawUnsafe<Array<{ indexname: string }>>(
      `SELECT indexname FROM pg_indexes
       WHERE schemaname='public' AND tablename='MenuItem'
         AND indexname='MenuItem_archivedAt_idx'`,
    ),
  );
  console.log("\n=== MenuItem_archivedAt_idx ===");
  if (Array.isArray(miIdx)) {
    if (miIdx.length === 0) console.log("  (index does not exist)");
    else console.log(`  exists: ${miIdx.map((i) => i.indexname).join(", ")}`);
  } else {
    console.log(`  ${miIdx.error}`);
  }

  const cc = await safe("counter cols", () =>
    prisma.$queryRawUnsafe<Array<{ column_name: string; is_nullable: string; data_type: string; column_default: string | null }>>(
      `SELECT column_name, is_nullable, data_type, column_default
       FROM information_schema.columns
       WHERE table_schema='public' AND table_name='Counter'
         AND column_name IN ('providerId','updatedAt')`,
    ),
  );
  console.log("\n=== Counter pending columns ===");
  if (Array.isArray(cc)) {
    if (cc.length === 0) console.log("  (none of the pending columns exist yet)");
    for (const c of cc) console.log(`  ${c.column_name} ${c.data_type} nullable=${c.is_nullable} default=${c.column_default}`);
  } else {
    console.log(`  ${cc.error}`);
  }

  const pt = await safe("provider table", () =>
    prisma.$queryRawUnsafe<Array<{ table_name: string }>>(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema='public' AND table_name='Provider'`,
    ),
  );
  console.log("\n=== Provider table ===");
  if (Array.isArray(pt)) {
    if (pt.length === 0) console.log("  (Provider table does not exist)");
    else console.log(`  exists: ${pt.map((p) => p.table_name).join(", ")}`);
  } else {
    console.log(`  ${pt.error}`);
  }

  const fk = await safe("counter fk", () =>
    prisma.$queryRawUnsafe<Array<{ conname: string }>>(
      `SELECT conname FROM pg_constraint
       WHERE conname = 'Counter_providerId_fkey'`,
    ),
  );
  console.log("\n=== Counter_providerId_fkey ===");
  if (Array.isArray(fk)) {
    if (fk.length === 0) console.log("  (FK does not exist)");
    else console.log(`  exists: ${fk.map((r) => r.conname).join(", ")}`);
  } else {
    console.log(`  ${fk.error}`);
  }

  const sample = await safe("menuitem sample", () =>
    prisma.$queryRawUnsafe<Array<{ id: string; name: string; createdAt: Date }>>(
      `SELECT id, name, "createdAt" FROM "MenuItem" ORDER BY "createdAt" LIMIT 3`,
    ),
  );
  console.log("\n=== MenuItem sample (first 3 by createdAt) ===");
  if (Array.isArray(sample)) {
    if (sample.length === 0) console.log("  (no rows)");
    for (const s of sample) console.log(`  id=${s.id} name=${s.name} createdAt=${s.createdAt.toISOString()}`);
  } else {
    console.log(`  ${sample.error}`);
  }
}

main()
  .catch((e) => {
    console.error("FATAL:", e);
    process.exit(2);
  })
  .finally(() => prisma.$disconnect());
