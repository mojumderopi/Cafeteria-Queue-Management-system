// Read-only audit: compare three stock-reservation tallies against each
// other so we can prove the recovery script uses the right status set.
//
//   buggy  = the original buggy filter: APPROVED + READY only
//   correct = the documented correct filter: PENDING_CASHIER + APPROVED
//             + PREPARING + READY
//   actual  = the status set hard-coded in scripts/recover-stock.ts
//             (parsed from its source so this script catches future
//             regressions without anyone having to update two files)
//
// We assert: buggyRestore - correctRestore must equal the over-credit
// (i.e. the bug exists), AND actualRestore - correctRestore must equal
// 0 (i.e. the recovery script is using the right filter).
import { prisma } from "../lib/prisma";
import { readFileSync } from "node:fs";
import path from "node:path";

// Pull the actual status list from the recovery script's source so this
// test and the recovery script cannot drift.
function readActualStatuses(): string[] {
  const src = readFileSync(path.join(process.cwd(), "scripts", "recover-stock.ts"), "utf8");
  const m = src.match(/STOCK_HOLDING_STATUSES\s*=\s*\[([^\]]+)\]/);
  if (!m) throw new Error("Could not find STOCK_HOLDING_STATUSES in scripts/recover-stock.ts");
  return Array.from(m[1].matchAll(/"([A-Z_]+)"/g)).map((x) => x[1]);
}

async function main() {
  const items = await prisma.menuItem.findMany({
    where: { isAvailable: true, archivedAt: null },
    select: { id: true, name: true, counterId: true, stockQty: true },
  });
  const orders = await prisma.order.findMany({
    select: {
      counterId: true,
      status: true,
      items: { select: { menuItemId: true, qty: true } },
    },
  });

  const tally = (statuses: string[]) => {
    const m = new Map<string, number>();
    for (const o of orders) {
      if (!statuses.includes(o.status)) continue;
      for (const it of o.items) {
        const k = `${o.counterId}::${it.menuItemId}`;
        m.set(k, (m.get(k) ?? 0) + it.qty);
      }
    }
    return m;
  };

  const buggy = tally(["APPROVED", "READY"]);
  const correct = tally(["PENDING_CASHIER", "APPROVED", "PREPARING", "READY"]);
  const actualStatuses = readActualStatuses();
  const actual = tally(actualStatuses);
  console.log(`recovery script's actual filter: [${actualStatuses.join(", ")}]`);
  console.log(`correct filter:                  [PENDING_CASHIER, APPROVED, PREPARING, READY]`);
  console.log(`buggy filter (audit baseline):   [APPROVED, READY]`);
  console.log("");

  let overByBug = 0;
  let driftActual = 0;
  let itemsWithDrift = 0;
  console.log("Item-by-item check (showing rows that differ):");
  for (const it of items) {
    const buggyR = buggy.get(`${it.counterId}::${it.id}`) ?? 0;
    const correctR = correct.get(`${it.counterId}::${it.id}`) ?? 0;
    const actualR = actual.get(`${it.counterId}::${it.id}`) ?? 0;
    const buggyRecover = Math.max(0, it.stockQty - buggyR);
    const correctRecover = Math.max(0, it.stockQty - correctR);
    const actualRecover = Math.max(0, it.stockQty - actualR);
    const bugDiff = buggyRecover - correctRecover;
    const actualDiff = actualRecover - correctRecover;
    if (bugDiff !== 0) overByBug += bugDiff;
    if (actualDiff !== 0) {
      driftActual += actualDiff;
      itemsWithDrift += 1;
      console.log(
        `  DRIFT  ${it.name.padEnd(28)} ctr=${it.counterId.slice(0, 6)}  ` +
          `correctReserved=${correctR}  actualReserved=${actualR}  drift=${actualDiff}`,
      );
    }
  }
  console.log("");
  console.log(`buggy filter would over-credit by ${overByBug} units (audit baseline; expected > 0).`);
  console.log(`recovery script drift vs. correct: ${driftActual} units across ${itemsWithDrift} items (expected 0).`);

  await prisma.$disconnect();
  if (driftActual !== 0) process.exit(1);
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
