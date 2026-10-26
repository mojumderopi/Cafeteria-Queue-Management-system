import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { canAccessCounter, getStaffFromCookie, verifyOrderToken } from "@/lib/auth";

// GET /api/orders/[id]?t=<token>
//
// Authorization: a requester may read an order if EITHER
//   (a) they hold a staff cookie that grants access to the order's
//       counter (CASHIER, KITCHEN, or ADMIN with counterIds: ["*"]),
//   OR
//   (b) they present a valid signed tracking token (`?t=...`) issued
//       for the same order id at order-creation time.
//
// Without one of those, the request returns 403. This closes the
// information disclosure where the order id alone (a cuid) was enough
// to read the full order including the displayed token, item list, and
// payment status.
export async function GET(req: Request, ctx: { params: { id: string } }) {
  const url = new URL(req.url);
  const tokenParam = url.searchParams.get("t");
  const order = await prisma.order.findUnique({
    where: { id: ctx.params.id },
    include: { items: { include: { menuItem: true } }, counter: true },
  });
  if (!order) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const staff = getStaffFromCookie();
  const isStaff = staff !== null && canAccessCounter(staff, order.counterId);
  const isTokenHolder = verifyOrderToken(order.id, tokenParam);
  if (!isStaff && !isTokenHolder) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  return NextResponse.json({
    order: {
      id: order.id,
      token: order.token,
      counterId: order.counterId,
      counterName: order.counter.name,
      status: order.status,
      paymentStatus: order.paymentStatus,
      totalCents: order.totalCents,
      priorityScore: order.priorityScore,
      rejectReason: order.rejectReason,
      createdAt: order.createdAt,
      approvedAt: order.approvedAt,
      readyAt: order.readyAt,
      completedAt: order.completedAt,
      items: order.items.map((it) => ({
        menuItemId: it.menuItemId,
        name: it.menuItem.name,
        qty: it.qty,
        unitPrice: it.unitPrice,
      })),
    },
  });
}
