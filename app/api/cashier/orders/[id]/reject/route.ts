import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { canAccessCounter, getStaffFromCookie } from "@/lib/auth";
import { releaseStock, dequeueOrder } from "@/lib/queue";
import { emitOrderStatus } from "@/lib/bus";

const Body = z.object({ reason: z.string().max(200).optional() });

export async function POST(req: Request, ctx: { params: { id: string } }) {
  const staff = getStaffFromCookie();
  if (!staff || (staff.role !== "CASHIER" && staff.role !== "ADMIN")) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  const reason = parsed.success ? parsed.data.reason : undefined;

  const order = await prisma.order.findUnique({
    where: { id: ctx.params.id },
    include: { items: true },
  });
  if (!order) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (!canAccessCounter(staff, order.counterId)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  if (order.status !== "PENDING_CASHIER") {
    return NextResponse.json({ error: "bad_state", status: order.status }, { status: 409 });
  }

  // Conditional update FIRST. We only release stock after we have
  // actually won the transition. If we released before the conditional
  // update and a concurrent caller had already moved the order out of
  // PENDING_CASHIER (e.g. the customer pressed Cancel a millisecond
  // before us), our release would be applied to a row that is still
  // legitimately holding the stock reservation — over-crediting the
  // counter and silently letting the other path collect later.
  const updated = await prisma.order.updateMany({
    where: { id: order.id, status: "PENDING_CASHIER" },
    data: { status: "REJECTED", rejectReason: reason ?? "Out of stock", completedAt: new Date() },
  });
  if (updated.count === 0) {
    return NextResponse.json({ error: "bad_state" }, { status: 409 });
  }
  await releaseStock(
    order.counterId,
    order.items.map((it: { menuItemId: string; qty: number }) => ({
      menuItemId: it.menuItemId,
      qty: it.qty,
    })),
  );
  await dequeueOrder(order.counterId, order.id);
  emitOrderStatus({
    orderId: order.id,
    token: order.token,
    counterId: order.counterId,
    status: "REJECTED",
    rejectReason: reason ?? "Out of stock",
  });
  return NextResponse.json({ ok: true, status: "REJECTED" });
}