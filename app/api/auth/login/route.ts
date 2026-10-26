import { NextResponse } from "next/server";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { setStaffCookie, clearStaffCookie } from "@/lib/auth";
import { rateLimit } from "@/lib/ratelimit";

const Body = z.object({
  phone: z.string().min(4),
  password: z.string().min(4),
});

export async function POST(req: Request) {
  // Per-IP login throttle: 5 burst, refill 1 per ~12s (5/min sustained).
  // Discourages credential stuffing without annoying legitimate users
  // who mistype a password.
  const rl = rateLimit(req, "POST /api/auth/login", { capacity: 5, refillPerSec: 1 / 12 });
  if (!rl.allow) {
    return NextResponse.json(
      { error: "rate_limited", retryAfterSec: rl.retryAfterSec },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } },
    );
  }

  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "bad_request" }, { status: 400 });

  const user = await prisma.user.findUnique({ where: { phone: parsed.data.phone } });
  if (!user || !user.passwordHash) return NextResponse.json({ error: "invalid_credentials" }, { status: 401 });
  const ok = await bcrypt.compare(parsed.data.password, user.passwordHash);
  if (!ok) return NextResponse.json({ error: "invalid_credentials" }, { status: 401 });
  if (!["CASHIER", "KITCHEN", "ADMIN"].includes(user.role)) {
    return NextResponse.json({ error: "not_staff" }, { status: 403 });
  }

  // Resolve which counters this user is allowed to act on.
  // ADMIN is treated as "all counters" via the "*" sentinel. Other staff
  // get a concrete allowlist; an empty list means no access (e.g. a staff
  // user who has not been assigned to any counter yet).
  let counterIds: string[] = [];
  if (user.role === "ADMIN") {
    counterIds = ["*"];
  } else {
    const links = await prisma.staffCounter.findMany({
      where: { userId: user.id },
      select: { counterId: true },
    });
    counterIds = links.map((l) => l.counterId);
  }

  setStaffCookie({
    sub: user.id,
    role: user.role as "CASHIER" | "KITCHEN" | "ADMIN",
    name: user.name ?? user.phone ?? "staff",
    counterIds,
  });
  return NextResponse.json({ ok: true, role: user.role, name: user.name });
}

export async function DELETE() {
  clearStaffCookie();
  return NextResponse.json({ ok: true });
}
