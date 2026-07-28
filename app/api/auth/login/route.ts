import { NextResponse } from "next/server";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { setStaffCookie, clearStaffCookie } from "@/lib/auth";

const Body = z.object({
  phone: z.string().min(4),
  password: z.string().min(4),
});

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "bad_request" }, { status: 400 });

  const user = await prisma.user.findUnique({ where: { phone: parsed.data.phone } });
  if (!user || !user.passwordHash) return NextResponse.json({ error: "invalid_credentials" }, { status: 401 });
  const ok = await bcrypt.compare(parsed.data.password, user.passwordHash);
  if (!ok) return NextResponse.json({ error: "invalid_credentials" }, { status: 401 });
  if (!["CASHIER", "KITCHEN", "ADMIN"].includes(user.role)) {
    return NextResponse.json({ error: "not_staff" }, { status: 403 });
  }

  setStaffCookie({ sub: user.id, role: user.role as "CASHIER" | "KITCHEN" | "ADMIN", name: user.name ?? user.phone ?? "staff" });
  return NextResponse.json({ ok: true, role: user.role, name: user.name });
}

export async function DELETE() {
  clearStaffCookie();
  return NextResponse.json({ ok: true });
}