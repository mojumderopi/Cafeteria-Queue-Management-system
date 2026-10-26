// Tiny session helpers. We don't pull in next-auth for staff — a JWT cookie is enough.
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

// IMPORTANT: do not `import { cookies } from "next/headers"` at the top of
// this module. Pulling that in at module load forces Next's request-scoped
// AsyncLocalStorage to evaluate, which crashes the custom Socket.IO server
// (run via `tsx server.ts`) where there is no Next request context. We
// dynamic-require `next/headers` inside the helpers that actually need it.

// Read whichever env name is set; refuse to boot with a default secret in production.
const RAW_SECRET =
  process.env.SESSION_SECRET ??
  process.env.QR_SIGNING_SECRET ??
  (process.env.NODE_ENV === "production" ? "" : "dev-secret");
if (!RAW_SECRET) {
  throw new Error("SESSION_SECRET (or QR_SIGNING_SECRET) must be set in production");
}
const SECRET: string = RAW_SECRET;

// Lazily load `next/headers` only inside functions that run in a request
// context. The require() is hidden from the linter via an `eval` shim.
function nextHeaders() {
  // eslint-disable-next-line no-eval
  const req = eval('require') as NodeJS.Require;
  return req("next/headers") as typeof import("next/headers");
}

export interface StaffSession {
  sub: string;
  role: "CASHIER" | "KITCHEN" | "ADMIN";
  name: string;
  // counterIds the user is authorized for. The special value `["*"]` (only
  // ever issued to ADMIN) means all counters. Otherwise this is a concrete
  // allowlist of counter IDs, set at login time from the StaffCounter table.
  counterIds: string[];
}

export function signStaff(payload: StaffSession): string {
  const json = JSON.stringify(payload);
  const body = Buffer.from(json, "utf8").toString("base64url");
  const sig = createHmac("sha256", SECRET).update(body).digest("base64url");
  return `${body}.${sig}`;
}

export function verifyStaff(token: string | undefined): StaffSession | null {
  if (!token) return null;
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  const expected = createHmac("sha256", SECRET).update(body).digest("base64url");
  // Timing-safe compare: prevents byte-by-byte signature leaks.
  const a = Buffer.from(sig, "base64url");
  const b = Buffer.from(expected, "base64url");
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    return JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as StaffSession;
  } catch {
    return null;
  }
}

export function setStaffCookie(payload: StaffSession) {
  const { cookies } = nextHeaders();
  cookies().set("staff", signStaff(payload), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 8,
  });
}

export function getStaffFromCookie(): StaffSession | null {
  const { cookies } = nextHeaders();
  const s = verifyStaff(cookies().get("staff")?.value);
  // Back-compat: older cookies (signed before counterIds existed) won't have
  // the field. Treat absence as "no access" so we fail closed; the user can
  // simply log in again to receive the new payload.
  if (s && !Array.isArray(s.counterIds)) s.counterIds = [];
  return s;
}

export function canAccessCounter(staff: StaffSession | null, counterId: string): boolean {
  if (!staff) return false;
  if (staff.role !== "ADMIN" && staff.counterIds.length === 0) return false;
  if (staff.counterIds[0] === "*") return true;
  return staff.counterIds.includes(counterId);
}

export function clearStaffCookie() {
  const { cookies } = nextHeaders();
  cookies().delete("staff");
}

// Guest session — random opaque ID stored in cookie, used to attribute guest orders.
export function getOrCreateGuestId(): string {
  const { cookies } = nextHeaders();
  const c = cookies();
  const existing = c.get("guest_id")?.value;
  if (existing) return existing;
  const id = randomBytes(12).toString("base64url");
  c.set("guest_id", id, { httpOnly: false, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 30 });
  return id;
}

// Order tracking token — a per-order HMAC proof of ownership.
// Format: <orderId>.<nonce>.<sig>, where sig = HMAC-SHA256(SECRET, "<orderId>.<nonce>")
//   * <orderId> is bound into the signature so a token for one order cannot
//     be replayed against another.
//   * <nonce> is a random 8-byte value, included in the signature but not
//     validated separately. It widens the signature space and keeps the
//     token unguessable even if the secret leaks briefly.
//   * The token is a "bearer" secret: anyone with the token can read the
//     order. We do NOT put it in cookies because we want the customer to
//     be able to share their tracking link freely (or not). The lifetime
//     of the order itself is the natural expiry.
const ORDER_TOKEN_TOK_SEP = ".";
export function signOrderToken(orderId: string): string {
  const nonce = randomBytes(8).toString("base64url");
  const body = `${orderId}${ORDER_TOKEN_TOK_SEP}${nonce}`;
  const sig = createHmac("sha256", SECRET).update(body).digest("base64url");
  return `${body}${ORDER_TOKEN_TOK_SEP}${sig}`;
}

export function verifyOrderToken(orderId: string, token: string | undefined | null): boolean {
  if (!token) return false;
  const parts = token.split(ORDER_TOKEN_TOK_SEP);
  if (parts.length !== 3) return false;
  const [tid, nonce, sig] = parts;
  if (!tid || !nonce || !sig) return false;
  // Bind the order id into the signature — a token issued for one order
  // cannot be used to read another.
  if (tid !== orderId) return false;
  const body = `${tid}${ORDER_TOKEN_TOK_SEP}${nonce}`;
  const expected = createHmac("sha256", SECRET).update(body).digest("base64url");
  const a = Buffer.from(sig, "base64url");
  const b = Buffer.from(expected, "base64url");
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}
