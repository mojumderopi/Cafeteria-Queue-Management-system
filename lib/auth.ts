// Tiny session helpers. We don't pull in next-auth for staff — a JWT cookie is enough.
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";

// Read whichever env name is set; refuse to boot with a default secret in production.
const RAW_SECRET =
  process.env.SESSION_SECRET ??
  process.env.QR_SIGNING_SECRET ??
  (process.env.NODE_ENV === "production" ? "" : "dev-secret");
if (!RAW_SECRET) {
  throw new Error("SESSION_SECRET (or QR_SIGNING_SECRET) must be set in production");
}
const SECRET: string = RAW_SECRET;

export interface StaffSession {
  sub: string;
  role: "CASHIER" | "KITCHEN" | "ADMIN";
  name: string;
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
  cookies().set("staff", signStaff(payload), {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 8,
  });
}

export function getStaffFromCookie(): StaffSession | null {
  return verifyStaff(cookies().get("staff")?.value);
}

export function clearStaffCookie() {
  cookies().delete("staff");
}

// Guest session — random opaque ID stored in cookie, used to attribute guest orders.
export function getOrCreateGuestId(): string {
  const c = cookies();
  const existing = c.get("guest_id")?.value;
  if (existing) return existing;
  const id = randomBytes(12).toString("base64url");
  c.set("guest_id", id, { httpOnly: false, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 30 });
  return id;
}