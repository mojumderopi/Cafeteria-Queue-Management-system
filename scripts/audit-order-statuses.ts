// Read-only audit: count orders by status and the items in non-final states.
import { prisma } from "../lib/prisma";

async function main() {
  const groups = await prisma.order.groupBy({
    by: ["status"],
    _count: { _all: true },
  });
  console.log("=== Orders by status ===");
  for (const g of groups.sort((a, b) => a.status.localeCompare(b.status))) {
    console.log(`  ${g.status.padEnd(16)} ${g._count._all}`);
  }

  const liveStatuses = ["PENDING_CASHIER", "APPROVED", "PREPARING", "READY"] as const;
  const live = await prisma.order.findMany({
    where: { status: { in: [...liveStatuses] } },
    select: {
      id: true,
      status: true,
      counterId: true,
      createdAt: true,
      items: { select: { menuItemId: true, qty: true } },
    },
  });
  console.log(`\n=== Live (non-final) orders: ${live.length} ===`);
  for (const o of live) {
    const items = o.items.map((it) => `${it.menuItemId.slice(0, 8)}=${it.qty}`).join(" ");
    console.log(`  ${o.id}  status=${o.status.padEnd(16)} ctr=${o.counterId}  ${items}`);
  }

  // Per-(counter,item) reservation tally, by status.
  const byStatusKey = new Map<string, number>();
  for (const o of live) {
    for (const it of o.items) {
      const k = `${o.status}|${o.counterId}|${it.menuItemId}`;
      byStatusKey.set(k, (byStatusKey.get(k) ?? 0) + it.qty);
    }
  }
  console.log("\n=== Reserved qty by (status,counter,item) ===");
  const rows = [...byStatusKey.entries()].sort();
  for (const [k, v] of rows) console.log(`  ${k} = ${v}`);

  // Items currently in DB (for baseline).
  const items = await prisma.menuItem.findMany({
    select: { id: true, name: true, counterId: true, stockQty: true, isAvailable: true, archivedAt: true },
    orderBy: [{ counterId: "asc" }, { name: "asc" }],
  });
  console.log(`\n=== MenuItems: ${items.length} ===`);

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
