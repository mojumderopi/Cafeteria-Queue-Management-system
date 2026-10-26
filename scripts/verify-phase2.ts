// Phase 2 isolated verification (no DB, no Redis).
//
// Exercises:
//   1. signOrderToken / verifyOrderToken — round-trip, wrong order, tampered sig, replay.
//   2. rateLimit — burst, drain, refill, separate IPs.
//
// Run with:  npx tsx scripts/verify-phase2.ts
// Exit code 0 = pass, 1 = fail.

import { signOrderToken, verifyOrderToken } from "../lib/auth";
import { rateLimit, _resetRateLimit } from "../lib/ratelimit";

let failures = 0;
function assert(cond: unknown, label: string) {
  if (cond) {
    console.log(`ok   ${label}`);
  } else {
    console.log(`FAIL ${label}`);
    failures += 1;
  }
}

// --- 1. order token ---

const orderA = "ckl1a2b3c4d5e6f7g8h9";
const orderB = "cklzz9y8x7w6v5u4t3s2";

const tokA = signOrderToken(orderA);
assert(typeof tokA === "string" && tokA.split(".").length === 3, "token has 3 parts");

// Round-trip works.
assert(verifyOrderToken(orderA, tokA) === true, "verify accepts freshly-signed token");

// Token for A does NOT verify for B (replay across orders).
assert(verifyOrderToken(orderB, tokA) === false, "token for A is rejected for B");

// Tampered signature is rejected.
const tampered = tokA.slice(0, -2) + "AA";
assert(verifyOrderToken(orderA, tampered) === false, "tampered signature is rejected");

// Missing token is rejected.
assert(verifyOrderToken(orderA, undefined) === false, "missing token is rejected");
assert(verifyOrderToken(orderA, null) === false, "null token is rejected");
assert(verifyOrderToken(orderA, "") === false, "empty token is rejected");

// Malformed token is rejected (not 3 parts).
assert(verifyOrderToken(orderA, "abc.def") === false, "two-part token is rejected");
assert(verifyOrderToken(orderA, "abc") === false, "one-part token is rejected");
assert(verifyOrderToken(orderA, "a.b.c.d") === false, "four-part token is rejected");

// Two tokens for the same order id are different (nonce).
const tokA2 = signOrderToken(orderA);
assert(tokA !== tokA2, "fresh tokens differ (random nonce)");
assert(verifyOrderToken(orderA, tokA2) === true, "second fresh token verifies");

// --- 2. rate limit ---

_resetRateLimit();
const mkReq = (ip: string): Request => {
  return new Request("http://localhost/x", { headers: { "x-forwarded-for": ip } });
};

// Burst of 3, refill slow.
const opts = { capacity: 3, refillPerSec: 1 / 10 };

const r1 = rateLimit(mkReq("10.0.0.1"), "test-route", opts);
const r2 = rateLimit(mkReq("10.0.0.1"), "test-route", opts);
const r3 = rateLimit(mkReq("10.0.0.1"), "test-route", opts);
assert(r1.allow && r2.allow && r3.allow, "first 3 within burst are allowed");

const r4 = rateLimit(mkReq("10.0.0.1"), "test-route", opts);
assert(!r4.allow && r4.retryAfterSec > 0, "4th call is throttled with retry hint");

// Different IP has its own bucket.
const otherR1 = rateLimit(mkReq("10.0.0.2"), "test-route", opts);
assert(otherR1.allow, "different IP is not throttled");

// Same IP, different route key has its own bucket.
const rOtherRoute = rateLimit(mkReq("10.0.0.1"), "other-route", opts);
assert(rOtherRoute.allow, "same IP different route has its own bucket");

console.log("");
if (failures === 0) {
  console.log("ALL CHECKS PASSED");
  process.exit(0);
} else {
  console.log(`FAILURES: ${failures}`);
  process.exit(1);
}
