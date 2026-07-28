// Concurrency proof: fire N parallel orders for the same low-stock item.
// Expect: success_count == stockQty, all others get 409 stock_short.
import { PrismaClient } from "@prisma/client";

const BASE = process.env.SMOKE_BASE ?? "http://localhost:3000";
const N = 50;
const STOCK = 10;

async function main() {
  const prisma = new PrismaClient();
  const counter = await prisma.counter.findUnique({ where: { slug: "canteen-a" } });
  if (!counter) throw new Error("seed first");

  // Pick an item, reset its stock to STOCK for a clean run.
  const item = await prisma.menuItem.findFirst({ where: { counterId: counter.id, name: "Coke 330ml" } });
  if (!item) throw new Error("seed missing Coke 330ml");
  await prisma.menuItem.update({ where: { id: item.id }, data: { stockQty: STOCK } });
  await fetch(`${BASE}/api/counters/canteen-a`); // warm up menu

  // Sync Redis to match DB.
  const { redis, k } = await import("../lib/redis");
  await redis.set(k.stock(counter.id, item.id), STOCK);

  const attempts = Array.from({ length: N }, async (_, i) => {
    const res = await fetch(`${BASE}/api/orders`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        counterSlug: counter.slug,
        items: [{ menuItemId: item.id, qty: 1 }],
      }),
    });
    return { i, status: res.status };
  });
  const results = await Promise.all(attempts);
  const ok = results.filter((r) => r.status === 201).length;
  const short = results.filter((r) => r.status === 409).length;

  console.log(`[concurrency] ${N} parallel POSTs, stock=${STOCK}`);
  console.log(`[concurrency] 201 success: ${ok}`);
  console.log(`[concurrency] 409 short:  ${short}`);
  if (ok !== STOCK) throw new Error(`FAIL: expected ${STOCK} successes, got ${ok}`);
  if (ok + short !== N) throw new Error(`FAIL: lost responses (${ok + short}/${N})`);
  console.log("[concurrency] PASS ✓");
  await prisma.$disconnect();
  await redis.quit();
}
main().catch((e) => { console.error(e); process.exit(1); });