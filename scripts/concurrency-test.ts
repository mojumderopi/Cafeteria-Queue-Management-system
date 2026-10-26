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
  // The new demo seed marks intentionally-sold-out items as isAvailable=false;
  // reset both fields so the order validator lets requests through.
  const item = await prisma.menuItem.findFirst({
    where: { counterId: counter.id, name: "Coke 330ml" },
  });
  if (!item) throw new Error("seed missing Coke 330ml — run npm run seed first");
  await prisma.menuItem.update({
    where: { id: item.id },
    data: { stockQty: STOCK, isAvailable: true },
  });
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
    let body: any = null;
    try { body = await res.json(); } catch { /* no body */ }
    return { i, status: res.status, body };
  });
  const results = await Promise.all(attempts);
  // The order API returns 200 on success, not 201. Treat anything in [200, 299] as success.
  const ok = results.filter((r) => r.status >= 200 && r.status < 300).length;
  const short = results.filter((r) => r.status === 409).length;
  const other = results.filter((r) => r.status !== 409 && (r.status < 200 || r.status >= 300));

  console.log(`[concurrency] ${N} parallel POSTs, stock=${STOCK}`);
  console.log(`[concurrency] 2xx success: ${ok}`);
  console.log(`[concurrency] 409 short:   ${short}`);
  if (other.length) {
    console.log(`[concurrency] other (first 3): ${JSON.stringify(other.slice(0, 3))}`);
  }
  if (ok !== STOCK) throw new Error(`FAIL: expected ${STOCK} successes, got ${ok}`);
  if (ok + short !== N) throw new Error(`FAIL: lost responses (${ok + short}/${N})`);
  console.log("[concurrency] PASS ✓");
  await prisma.$disconnect();
  await redis.quit();
}
main().catch((e) => { console.error(e); process.exit(1); });
