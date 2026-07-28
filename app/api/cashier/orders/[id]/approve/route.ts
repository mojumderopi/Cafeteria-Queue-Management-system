import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getStaffFromCookie } from "@/lib/auth";
import { emitOrderStatus } from "@/lib/bus";

export async function POST(_req: Request, ctx: { params: { id: string } }) {
  const staff = getStaffFromCookie();
  if (!staff || (staff.role !== "CASHIER" && staff.role !== "ADMIN")) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const order = await prisma.order.findUnique({ where: { id: ctx.params.id } });
  if (!order) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (order.status !== "PENDING_CASHIER") {
    return NextResponse.json({ error: "bad_state", status: order.status }, { status: 409 });
  }

  const updated = await prisma.order.update({
    where: { id: order.id },
    data: { status: "APPROVED", approvedAt: new Date() },
  });
  emitOrderStatus({
    orderId: updated.id,
    token: updated.token,
    counterId: updated.counterId,
    status: "APPROVED",
  });
  return NextResponse.json({ ok: true, status: updated.status });
}