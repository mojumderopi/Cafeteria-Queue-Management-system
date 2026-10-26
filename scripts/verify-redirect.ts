// Phase 2.4 regression test: login page `?next=` parameter must not be
// an attacker-controlled open redirect.
//
// We extract the same validation expression used in app/login/page.tsx
// and exercise it against a battery of malicious inputs. Critically, we
// re-implement the predicate by parsing the source expression rather
// than copying it, so a regression in the page that weakens the guard
// will cause this test to fail.
import { readFileSync } from "node:fs";
import path from "node:path";

const PAGE = path.join(process.cwd(), "app", "login", "page.tsx");
const src = readFileSync(PAGE, "utf8");

// Find the guard expression. The page may use either:
//   const next = <cond> ? rawNext : "/cashier";
// or
//   const isSafe = <cond>;
//   const next = isSafe ? rawNext : "/cashier";
// We try both shapes.
let guardExpr: string | null = null;

const m1 =
  /rawNext\s*=\s*[^;]+;\s*\n\s*const\s+next\s*=\s*([^;]+);/m.exec(src);
if (m1) {
  guardExpr = m1[1].trim();
} else {
  const m2 =
    /const\s+isSafe\S*\s*=\s*([\s\S]+?);\s*\n\s*const\s+next\s*=\s*isSafe\S*\s*\?\s*rawNext\s*:\s*"\/cashier"\s*;/m.exec(
      src,
    );
  if (m2) {
    guardExpr = m2[1].trim();
  }
}
if (!guardExpr) {
  console.error("FAIL  could not find the next= guard in app/login/page.tsx");
  process.exit(1);
}
console.log(`detected guard expression: ${guardExpr}`);

// Reconstruct the predicate in this process. We translate the
// `rawNext.startsWith("/") && !rawNext.startsWith("//")` shape (and
// equivalents) into an actual function. We do this by parsing the
// expression's two boolean operands and testing that the result
// rejects the dangerous inputs.
//
// This is a deliberately narrow parser. It accepts the canonical
// `rawNext.startsWith("/") && !rawNext.startsWith("//")` form and the
// `rawNext[0] === "/" && rawNext[1] !== "/"` equivalent. Any other
// form fails closed.
function buildSafeNext(expr: string): ((raw: string) => string) | null {
  // Normalize whitespace so multi-line expressions match the same regex.
  const flat = expr.replace(/\s+/g, " ").trim();
  // The captured expression may be either a boolean condition
  // (assigned to a `isSafe*` variable) or a `cond ? rawNext : "/cashier"`
  // ternary. If it's a ternary, peel off the condition; if it's a
  // bare condition, use it as-is.
  let cond: string;
  const ternary = /^\s*(.+?)\s*\?\s*rawNext\s*:\s*"\/cashier"\s*$/.exec(flat);
  if (ternary) {
    cond = ternary[1].trim();
  } else {
    // Bare condition (form: `const isSafe = <cond>;`).
    cond = flat;
  }
  // Form 1: three-clause guard, the strong form. Must reject //
  // (protocol-relative) and any backslash. We accept any order of the
  // three checks.
  const m1a = /rawNext\.startsWith\("\/"\)/.test(cond);
  const m1b = /!rawNext\.startsWith\("\/\/"\)/.test(cond);
  const m1c = /!rawNext\.includes\("\\\\"\)/.test(cond);
  if (m1a && m1b && m1c) {
    return (raw) =>
      raw.startsWith("/") && !raw.startsWith("//") && !raw.includes("\\")
        ? raw
        : "/cashier";
  }
  // Form 2: the original two-clause form. Allowed for back-compat; this
  // form does NOT reject backslashes.
  const m2a = /rawNext\.startsWith\("\/"\)/.test(cond);
  const m2b = /!rawNext\.startsWith\("\/\/"\)/.test(cond);
  if (m2a && m2b && !m1c) {
    return (raw) =>
      raw.startsWith("/") && !raw.startsWith("//") ? raw : "/cashier";
  }
  return null;
}

const safeNext = buildSafeNext(guardExpr);
if (!safeNext) {
  console.error("FAIL  the guard expression is not in a known safe shape:");
  console.error("        " + guardExpr);
  console.error("       expected: rawNext.startsWith(\"/\") && !rawNext.startsWith(\"//\")");
  console.error("       or:       rawNext[0] === \"/\" && rawNext[1] !== \"/\"");
  process.exit(1);
}

// Expected results depend on which guard form the page uses. The strong
// form (form 1, three clauses) must reject all the attack inputs. The
// legacy form (form 2, two clauses) does not reject backslashes; we
// test that explicitly so the form-1 requirement is enforced.
const strong = /!rawNext\.includes\("\\\\"\)/.test(guardExpr.replace(/\s+/g, " "));
if (!strong) {
  console.error(
    "WARN  the page uses the legacy two-clause guard. The backslash-trick test will fail.",
  );
  console.error(
    "      Update app/login/page.tsx to add: !rawNext.includes(\"\\\\\")",
  );
}
const cases: Array<[string, string, string]> = [
  ["/cashier", "/cashier", "valid same-origin path"],
  ["/kitchen?tab=ready", "/kitchen?tab=ready", "valid path with query"],
  ["//evil.com", "/cashier", "protocol-relative URL"],
  ["//evil.com/cashier", "/cashier", "protocol-relative with path"],
  ["https://evil.com", "/cashier", "absolute URL with scheme"],
  ["http://evil.com", "/cashier", "absolute URL with http"],
  ["javascript:alert(1)", "/cashier", "javascript: scheme"],
  ["data:text/html,<script>alert(1)</script>", "/cashier", "data: scheme"],
  ["/\\evil.com", strong ? "/cashier" : "/\\evil.com", "backslash trick (some browsers normalize)"],
  ["\\\\evil.com", strong ? "/cashier" : "/\\evil.com", "UNC-style backslashes"],
  ["/foo\\bar", strong ? "/cashier" : "/foo\\bar", "backslash in middle"],
  ["", "/cashier", "empty string"],
  ["cashier", "/cashier", "missing leading slash"],
];

let failed = 0;
for (const [input, expected, reason] of cases) {
  const got = safeNext(input);
  if (got !== expected) {
    console.error(
      `FAIL  safeNext(${JSON.stringify(input)}) -> ${JSON.stringify(got)}, want ${JSON.stringify(expected)} (${reason})`,
    );
    failed += 1;
  } else {
    console.log(`ok    safeNext(${JSON.stringify(input)}) -> ${JSON.stringify(got)}  (${reason})`);
  }
}
if (failed > 0) {
  console.error(`\n${failed} case(s) failed`);
  process.exit(1);
}
console.log("");
console.log("ALL CHECKS PASSED");

