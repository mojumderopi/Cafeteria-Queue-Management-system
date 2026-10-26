import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { releaseStock, dequeueOrder } from "@/lib/queue";
import { emitOrderStatus } from "@/lib/bus";
import { canAccessCounter, getStaffFromCookie } from "@/lib/auth";

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
  if (!canAccessCounter(staff, order.counterId)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  // Only cancellable before kitchen starts prep.
  if (order.status !== "PENDING_CASHIER") {
    return NextResponse.json({ error: "not_cancellable", status: order.status }, { status: 409 });
  }

  // Conditional update FIRST, then release stock. Releasing before the
  // conditional update can over-credit the counter: if a concurrent
  // caller already moved the order out of PENDING_CASHIER (e.g. the
  // cashier approved at the same instant), our release would apply to
  // a row that is still legitimately holding the reservation.
  const updated = await prisma.order.updateMany({
    where: { id: order.id, status: "PENDING_CASHIER" },
    data: { status: "CANCELLED", completedAt: new Date() },
  });
  if (updated.count === 0) {
    return NextResponse.json({ error: "bad_state" }, { status: 409 });
  }
  await releaseStock(order.counterId, order.items.map((it) => ({ menuItemId: it.menuItemId, qty: it.qty })));
  await dequeueOrder(order.counterId, order.id);

  emitOrderStatus({
    orderId: order.id,
    token: order.token,
    counterId: order.counterId,
    status: "CANCELLED",
  });

  return NextResponse.json({ ok: true });
}