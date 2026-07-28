import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { releaseStock, dequeueOrder } from "@/lib/queue";
import { emitOrderStatus } from "@/lib/bus";
import { getStaffFromCookie } from "@/lib/auth";

export async function POST(_req: Request, ctx: { params: { id: string } }) {
  const staff = getStaffFromCookie();
  if (!staff || (staff.role !== "CASHIER" && staff.role !== "ADMIN")) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const order = await prisma.order.findUnique({
    where: { id: ctx.params.id },
    include: { items: true },
  });
  if (!order) return NextResponse.json({ error: "not_found" }, { status: 404 });

  // Only cancellable before kitchen starts prep.
  if (order.status !== "PENDING_CASHIER") {
    return NextResponse.json({ error: "not_cancellable", status: order.status }, { status: 409 });
  }

  await releaseStock(order.counterId, order.items.map((it) => ({ menuItemId: it.menuItemId, qty: it.qty })));
  await dequeueOrder(order.counterId, order.id);
  const updated = await prisma.order.update({
    where: { id: order.id },
    data: { status: "CANCELLED", completedAt: new Date() },
  });

  emitOrderStatus({
    orderId: updated.id,
    token: updated.token,
    counterId: updated.counterId,
    status: "CANCELLED",
  });

  return NextResponse.json({ ok: true });
}