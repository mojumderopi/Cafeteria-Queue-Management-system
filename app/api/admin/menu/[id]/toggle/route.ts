import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getStaffFromCookie } from "@/lib/auth";

// Staff toggles menu item availability. Useful for "running out" situations.
export async function POST(req: Request, ctx: { params: { id: string } }) {
  const staff = getStaffFromCookie();
  if (!staff || staff.role !== "ADMIN") return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const { isAvailable } = await req.json().catch(() => ({ isAvailable: undefined }));
  if (typeof isAvailable !== "boolean") return NextResponse.json({ error: "bad_request" }, { status: 400 });

  const item = await prisma.menuItem.findUnique({ where: { id: ctx.params.id } });
  if (!item) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const updated = await prisma.menuItem.update({
    where: { id: item.id },
    data: { isAvailable },
  });
  return NextResponse.json({ ok: true, isAvailable: updated.isAvailable });
}