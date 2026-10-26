// Phase 3.3 / 3.7 regression: every admin mutation that touches a
// counter-scoped resource must check canAccessCounter before doing the
// write. This is a static scan. It is intentionally conservative: a
// new mutation route that fails this test has to consciously add a
// proper authorization gate.
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const roots = [
  "app/api/admin",
  "app/api/cashier",
  "app/api/kitchen",
  "app/api/orders",
  "app/api/counters",
];

interface FileCheck {
  file: string;
  needsAuthz: boolean;
  reason: string;
}

function walk(dir: string, out: string[] = []): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const e of entries) {
    const full = path.join(dir, e);
    let s;
    try {
      s = statSync(full);
    } catch {
      continue;
    }
    if (s.isDirectory()) walk(full, out);
    else if (full.endsWith("route.ts")) out.push(full);
  }
  return out;
}

const mutatingMethods = ["POST", "PUT", "PATCH", "DELETE"];
const checks: FileCheck[] = [];

// Routes that are intentionally unauthenticated (e.g. guest order
// creation, public counter lookups). They are exempt from the
// canAccessCounter / staff-cookie gate. Any new entry here must be
// reviewed.
const PUBLIC_ROUTES = new Set<string>([
  // Guest / student order creation. No staff session. The request is
  // rate-limited at the edge and validated by zod.
  "app/api/orders/route.ts",
  // Public menu + counter lookup. The slug is part of the URL and
  // reveals no private data; returns only availability.
  "app/api/counters/[slug]/route.ts",
]);

for (const root of roots) {
  for (const file of walk(path.join(process.cwd(), root))) {
    const rel = file.replace(process.cwd() + path.sep, "").replace(/\\/g, "/");
    if (PUBLIC_ROUTES.has(rel)) continue;
    const src = readFileSync(file, "utf8");
    for (const m of mutatingMethods) {
      // Match `export async function POST(...)`, `export async function DELETE(...)` etc.
      const re = new RegExp(`export\\s+async\\s+function\\s+${m}\\b`);
      if (!re.test(src)) continue;
      checks.push({
        file: rel,
        needsAuthz: true,
        reason: `exports ${m}`,
      });
    }
  }
}

let failed = false;
for (const c of checks) {
  const src = readFileSync(path.join(process.cwd(), c.file), "utf8");
  // We require the auth check to appear BEFORE the first Prisma write
  // call (prisma.X.create, prisma.X.update, prisma.X.updateMany, prisma.X.delete,
  // prisma.X.upsert). If the destructive call precedes the auth gate,
  // a single regex substring match would pass the test incorrectly.
  const authIdx = (() => {
    const needles = [
      "canAccessCounter(",
      "getStaffFromCookie()",
      "if (!staff)",
    ];
    let min = src.length;
    for (const n of needles) {
      const i = src.indexOf(n);
      if (i >= 0 && i < min) min = i;
    }
    return min === src.length ? -1 : min;
  })();
  const destructiveIdx = (() => {
    const re = /prisma\.\w+\.(create|update|updateMany|delete|upsert)\b/;
    const m = re.exec(src);
    return m ? m.index : src.length;
  })();
  const hasAuthz = authIdx >= 0;
  if (!hasAuthz) {
    console.error(`FAIL  ${c.file}: ${c.reason} handler has no authorization check`);
    failed = true;
  } else if (destructiveIdx < authIdx) {
    console.error(
      `FAIL  ${c.file}: ${c.reason} handler runs a Prisma write before the auth gate`,
    );
    failed = true;
  } else {
    console.log(`ok    ${c.file}  (${c.reason})`);
  }
}
if (failed) process.exit(1);
console.log("");
console.log("ALL CHECKS PASSED");
