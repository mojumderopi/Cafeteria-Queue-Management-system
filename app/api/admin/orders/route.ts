import { NextResponse } from "next/server";
import { OrderStatus, PaymentStatus, type Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getStaffFromCookie } from "@/lib/auth";

// GET /api/admin/orders?counterId=...&status=...&from=...&to=...&take=...
// Historical order browser for ADMIN. Includes archived menu items so
// historical data still resolves. No mutation endpoints.
export async function GET(req: Request) {
  const staff = getStaffFromCookie();
  if (!staff) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  if (staff.role !== "ADMIN") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const url = new URL(req.url);
  const counterId = url.searchParams.get("counterId");
  const status = url.searchParams.get("status");
  const payment = url.searchParams.get("payment");
  const fromStr = url.searchParams.get("from");
  const toStr = url.searchParams.get("to");
  const take = Math.max(1, Math.min(200, Number(url.searchParams.get("take") ?? 50)));

  const where: Prisma.OrderWhereInput = {};
  if (counterId) where.counterId = counterId;
  if (status) where.status = status as OrderStatus;
  if (payment) where.paymentStatus = payment as PaymentStatus;
  if (fromStr || toStr) {
    const from = fromStr ? new Date(fromStr) : new Date(0);
    const to = toStr ? new Date(toStr) : new Date(Date.now() + 60_000);
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
      return NextResponse.json({ error: "bad_request" }, { status: 400 });
    }
    where.createdAt = { gte: from, lte: to };
  }

  const orders = await prisma.order.findMany({
    where,
    include: {
      items: { include: { menuItem: true } },
      counter: { select: { id: true, name: true, slug: true } },
    },
    orderBy: { createdAt: "desc" },
    take,
  });

  return NextResponse.json({
    orders: orders.map((o) => ({
      id: o.id,
      token: o.token,
      counter: o.counter,
      status: o.status,
      paymentStatus: o.paymentStatus,
      totalCents: o.totalCents,
      priorityScore: o.priorityScore,
      createdAt: o.createdAt,
      approvedAt: o.approvedAt,
      readyAt: o.readyAt,
      completedAt: o.completedAt,
      guestPhone: o.guestPhone,
      items: o.items.map((it) => ({
        id: it.id,
        menuItemId: it.menuItemId,
        name: it.menuItem.name,
        qty: it.qty,
        unitPrice: it.unitPrice,
        // Archived flag is included so the UI can dim retired items.
        archived: !!(it.menuItem as { archivedAt?: Date | null }).archivedAt,
      })),
    })),
  });
}
