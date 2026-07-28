import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(_req: Request, ctx: { params: { id: string } }) {
  const order = await prisma.order.findUnique({
    where: { id: ctx.params.id },
    include: { items: { include: { menuItem: true } }, counter: true },
  });
  if (!order) return NextResponse.json({ error: "not_found" }, { status: 404 });
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