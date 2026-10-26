// Phase 3.4 / 3.7 regression: every sensitive admin mutation must call
// audit() at least once in the success path. This test statically scans
// the admin route handlers and asserts the audit call is present.
import { readFileSync } from "node:fs";
import path from "node:path";

interface Case {
  file: string;
  action: string; // expected action name in audit(...)
  trigger: string; // marker substring that indicates we have reached the success path
}

const cases: Case[] = [
  { file: "app/api/admin/menu/items/route.ts", action: "menu.item.create", trigger: "setStock(item.counterId" },
  { file: "app/api/admin/menu/items/[id]/stock/route.ts", action: "menu.item.restock", trigger: "setStockQty(ctx.params.id" },
  { file: "app/api/admin/menu/items/[id]/archive/route.ts", action: "menu.item.archive", trigger: "await archive" },
  { file: "app/api/admin/menu/items/[id]/archive/route.ts", action: "menu.item.restore", trigger: "await restore" },
  { file: "app/api/admin/menu/items/[id]/availability/route.ts", action: "menu.item.availability", trigger: "setAvailability" },
];

let failed = false;
for (const c of cases) {
  const src = readFileSync(path.join(process.cwd(), c.file), "utf8");
  const triggerIdx = src.indexOf(c.trigger);
  if (triggerIdx < 0) {
    console.error(`FAIL  ${c.file}: trigger ${JSON.stringify(c.trigger)} not found`);
    failed = true;
    continue;
  }
  const after = src.slice(triggerIdx);
  const auditIdx = after.indexOf("audit(");
  if (auditIdx < 0) {
    console.error(`FAIL  ${c.file}: no audit() call after ${JSON.stringify(c.trigger)}`);
    failed = true;
    continue;
  }
  // The action string must appear inside the audit() call.
  const auditWindow = after.slice(auditIdx, auditIdx + 400);
  if (!auditWindow.includes(c.action)) {
    console.error(`FAIL  ${c.file}: audit() call does not include action ${JSON.stringify(c.action)}`);
    failed = true;
    continue;
  }
  console.log(`ok    ${c.file}  -> ${c.action}`);
}
if (failed) process.exit(1);
console.log("");
console.log("ALL CHECKS PASSED");
