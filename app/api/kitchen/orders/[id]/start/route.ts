import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { canAccessCounter, getStaffFromCookie } from "@/lib/auth";
import { emitOrderStatus } from "@/lib/bus";

export async function POST(_req: Request, ctx: { params: { id: string } }) {
  const staff = getStaffFromCookie();
  if (!staff || (staff.role !== "KITCHEN" && staff.role !== "ADMIN")) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const order = await prisma.order.findUnique({ where: { id: ctx.params.id } });
  if (!order) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (!canAccessCounter(staff, order.counterId)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  if (order.status !== "APPROVED") {
    return NextResponse.json({ error: "bad_state", status: order.status }, { status: 409 });
  }
  // Atomic conditional update.
  const updated = await prisma.order.updateMany({
    where: { id: order.id, status: "APPROVED" },
    data: { status: "PREPARING" },
  });
  if (updated.count === 0) {
    return NextResponse.json({ error: "bad_state" }, { status: 409 });
  }
  emitOrderStatus({
    orderId: order.id,
    token: order.token,
    counterId: order.counterId,
    status: "PREPARING",
  });
  return NextResponse.json({ ok: true });
}