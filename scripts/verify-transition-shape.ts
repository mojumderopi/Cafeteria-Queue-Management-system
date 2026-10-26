// Phase 2.5 / 3.7 regression: every order status transition must be
// implemented as a conditional Prisma `updateMany` that includes the
// source status in its `where` clause. A read-then-update (findUnique
// followed by update) is racy and is forbidden here. We check the
// shape statically.
import { readFileSync } from "node:fs";
import path from "node:path";

interface Check {
  file: string;
  status: string; // source status the route should require
  forbidden: RegExp[]; // patterns that, if present, indicate a regression
  required: RegExp[]; // patterns that must be present in the success path
}

const checks: Check[] = [
  {
    file: "app/api/cashier/orders/[id]/approve/route.ts",
    status: "PENDING_CASHIER",
    forbidden: [/prisma\.order\.update\(/],
    required: [/updateMany\(/, /status:\s*"PENDING_CASHIER"/, /\.count\s*===\s*0/],
  },
  {
    file: "app/api/cashier/orders/[id]/reject/route.ts",
    status: "PENDING_CASHIER",
    forbidden: [/prisma\.order\.update\(/],
    required: [/updateMany\(/, /status:\s*"PENDING_CASHIER"/, /\.count\s*===\s*0/],
  },
  {
    file: "app/api/cashier/orders/[id]/collect/route.ts",
    status: "READY",
    forbidden: [/prisma\.order\.update\(/],
    required: [/updateMany\(/, /status:\s*"READY"/, /\.count\s*===\s*0/],
  },
  {
    file: "app/api/kitchen/orders/[id]/start/route.ts",
    status: "APPROVED",
    forbidden: [/prisma\.order\.update\(/],
    required: [/updateMany\(/, /status:\s*"APPROVED"/, /\.count\s*===\s*0/],
  },
  {
    file: "app/api/kitchen/orders/[id]/ready/route.ts",
    status: "PREPARING",
    forbidden: [/prisma\.order\.update\(/],
    required: [/updateMany\(/, /status:\s*"PREPARING"/, /\.count\s*===\s*0/],
  },
  {
    file: "app/api/orders/[id]/cancel/route.ts",
    status: "PENDING_CASHIER",
    forbidden: [/prisma\.order\.update\(/],
    required: [/updateMany\(/, /status:\s*"PENDING_CASHIER"/, /\.count\s*===\s*0/],
  },
];

let failed = 0;
for (const c of checks) {
  const src = readFileSync(path.join(process.cwd(), c.file), "utf8");
  for (const re of c.forbidden) {
    if (re.test(src)) {
      console.error(`FAIL  ${c.file}: matches forbidden pattern ${re} (use updateMany)`);
      failed += 1;
    }
  }
  for (const re of c.required) {
    if (!re.test(src)) {
      console.error(`FAIL  ${c.file}: missing required pattern ${re}`);
      failed += 1;
    }
  }
  if (failed === 0) console.log(`ok    ${c.file}  (source status: ${c.status})`);
}
if (failed > 0) {
  console.error(`\n${failed} transition check(s) failed`);
  process.exit(1);
}
console.log("");
console.log("ALL CHECKS PASSED");
