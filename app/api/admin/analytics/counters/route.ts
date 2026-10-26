import { NextResponse } from "next/server";
import { OrderStatus, PaymentStatus, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getStaffFromCookie } from "@/lib/auth";

// GET /api/admin/analytics/counters?from=ISO&to=ISO
// Per-counter comparison: sales, completed orders, avg order value, and
// the best-selling item (by revenue) for the window.
export async function GET(req: Request) {
  const staff = getStaffFromCookie();
  if (!staff) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  if (staff.role !== "ADMIN") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const url = new URL(req.url);
  const fromStr = url.searchParams.get("from");
  const toStr = url.searchParams.get("to");
  const now = new Date();
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  const from = fromStr ? new Date(fromStr) : startOfToday;
  const to = toStr ? new Date(toStr) : new Date(now.getTime() + 60_000);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }

  const counters = await prisma.counter.findMany({
    select: { id: true, name: true, slug: true },
    orderBy: { name: "asc" },
  });

  const qualifyingWhere: Prisma.OrderWhereInput = {
    status: { in: [OrderStatus.COMPLETED] },
    paymentStatus: PaymentStatus.PAID,
    completedAt: { gte: from, lte: to },
  };

  const out: Array<{
    counterId: string;
    name: string;
    slug: string;
    salesCents: number;
    completedOrders: number;
    avgOrderCents: number;
    bestItem: { menuItemId: string; name: string; revenueCents: number; qty: number } | null;
  }> = [];

  for (const c of counters) {
    const agg = await prisma.order.aggregate({
      where: { ...qualifyingWhere, counterId: c.id },
      _sum: { totalCents: true },
      _count: { _all: true },
    });
    const salesCents = agg._sum.totalCents ?? 0;
    const completedOrders = agg._count._all;
    const avgOrderCents = completedOrders > 0 ? Math.round(salesCents / completedOrders) : 0;

    // Best-selling item for this counter in the window: aggregate in JS.
    const rows = await prisma.orderItem.findMany({
      where: { order: { ...qualifyingWhere, counterId: c.id } },
      select: { menuItemId: true, qty: true, unitPrice: true },
    });
    const itemAgg = new Map<string, { qty: number; revenue: number }>();
    for (const r of rows) {
      const e = itemAgg.get(r.menuItemId) ?? { qty: 0, revenue: 0 };
      e.qty += r.qty;
      e.revenue += r.qty * r.unitPrice;
      itemAgg.set(r.menuItemId, e);
    }
    let bestItem = null;
    if (itemAgg.size > 0) {
      const [bestId, bestAgg] = [...itemAgg.entries()].sort(
        (a, b) => b[1].revenue - a[1].revenue,
      )[0];
      const m = await prisma.menuItem.findUnique({
        where: { id: bestId },
        select: { name: true },
      });
      bestItem = {
        menuItemId: bestId,
        name: m?.name ?? "Removed item",
        revenueCents: bestAgg.revenue,
        qty: bestAgg.qty,
      };
    }

    out.push({
      counterId: c.id,
      name: c.name,
      slug: c.slug,
      salesCents,
      completedOrders,
      avgOrderCents,
      bestItem,
    });
  }

  return NextResponse.json({
    range: { from: from.toISOString(), to: to.toISOString() },
    counters: out,
  });
}
