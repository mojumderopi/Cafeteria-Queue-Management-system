// Phase 2.3 / 3.7 regression: the recovery script must use the exact
// set of statuses that hold Redis stock. A previous version missed
// PENDING_CASHIER and PREPARING, which would have over-credited 12
// stock units. This test fails loudly if anyone edits the set in a
// way that re-introduces the bug.
import { readFileSync } from "node:fs";
import path from "node:path";

const REQUIRED = new Set(["PENDING_CASHIER", "APPROVED", "PREPARING", "READY"]);
const FORBIDDEN = new Set(["REJECTED", "CANCELLED", "COMPLETED"]);

const src = readFileSync(
  path.join(process.cwd(), "scripts", "recover-stock.ts"),
  "utf8",
);

// Find the literal array.
const match = src.match(
  /STOCK_HOLDING_STATUSES\s*=\s*\[([\s\S]*?)\]\s*as\s*const/m,
);
if (!match) {
  console.error("FAIL  could not find STOCK_HOLDING_STATUSES in recover-stock.ts");
  process.exit(1);
}
const body = match[1];
const found = new Set<string>();
for (const m of body.matchAll(/"([A-Z_]+)"/g)) {
  found.add(m[1]);
}
console.log(`detected statuses: ${[...found].sort().join(", ")}`);

let ok = true;
for (const s of REQUIRED) {
  if (!found.has(s)) {
    console.error(`FAIL  required status ${s} missing from STOCK_HOLDING_STATUSES`);
    ok = false;
  }
}
for (const s of FORBIDDEN) {
  if (found.has(s)) {
    console.error(`FAIL  forbidden status ${s} present in STOCK_HOLDING_STATUSES`);
    ok = false;
  }
}
if (found.size !== REQUIRED.size) {
  console.error(`FAIL  expected ${REQUIRED.size} statuses, found ${found.size}`);
  ok = false;
}
if (!ok) process.exit(1);
console.log("ok    STOCK_HOLDING_STATUSES matches the required set");
console.log("");
console.log("ALL CHECKS PASSED");
