import { NextResponse } from "next/server";
import { OrderStatus, PaymentStatus, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getStaffFromCookie } from "@/lib/auth";

// GET /api/admin/analytics/bestsellers?from=ISO&to=ISO&by=quantity|revenue&counterId=...
// Two rankings over the qualifying (COMPLETED + PAID) order set:
//   - by=quantity: total OrderItem.qty per menuItem
//   - by=revenue:  total OrderItem.qty * unitPrice per menuItem
// Uses the historical OrderItem.unitPrice snapshot, not today's menu price.
export async function GET(req: Request) {
  const staff = getStaffFromCookie();
  if (!staff) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  if (staff.role !== "ADMIN") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const url = new URL(req.url);
  const fromStr = url.searchParams.get("from");
  const toStr = url.searchParams.get("to");
  const by = (url.searchParams.get("by") ?? "quantity").toLowerCase();
  const counterId = url.searchParams.get("counterId");
  const limit = Math.max(1, Math.min(50, Number(url.searchParams.get("limit") ?? 10)));

  if (by !== "quantity" && by !== "revenue") {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }
  const now = new Date();
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  const from = fromStr ? new Date(fromStr) : startOfToday;
  const to = toStr ? new Date(toStr) : new Date(now.getTime() + 60_000);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }

  const where: Prisma.OrderWhereInput = {
    status: { in: [OrderStatus.COMPLETED] as OrderStatus[] },
    paymentStatus: PaymentStatus.PAID,
    completedAt: { gte: from, lte: to },
  };
  if (counterId) where.counterId = counterId;

  // Sum (qty * unitPrice) per menuItem in JS because groupBy._sum cannot
  // multiply columns. The result set is bounded by the date window, which
  // is fine for a single cafeteria's analytics. For larger datasets a
  // raw SQL aggregate would be appropriate.
  const rows = await prisma.orderItem.findMany({
    where: { order: where },
    select: { menuItemId: true, qty: true, unitPrice: true },
  });
  const agg = new Map<string, { qty: number; revenue: number }>();
  for (const r of rows) {
    const e = agg.get(r.menuItemId) ?? { qty: 0, revenue: 0 };
    e.qty += r.qty;
    e.revenue += r.qty * r.unitPrice;
    agg.set(r.menuItemId, e);
  }
  // Resolve menuItemId -> name + image, including archived items so
  // historical analytics keep working after an item is retired.
  const ids = [...agg.keys()];
  const menu = await prisma.menuItem.findMany({
    where: { id: { in: ids } },
    select: { id: true, name: true, imageUrl: true, counterId: true },
  });
  const byId = new Map(menu.map((m) => [m.id, m]));
  const ranked = [...agg.entries()].map(([id, v]) => ({
    menuItemId: id,
    name: byId.get(id)?.name ?? "Removed item",
    imageUrl: byId.get(id)?.imageUrl ?? null,
    counterId: byId.get(id)?.counterId ?? null,
    qty: v.qty,
    revenueCents: v.revenue,
  }));
  ranked.sort((a, b) => (by === "quantity" ? b.qty - a.qty : b.revenueCents - a.revenueCents));

  return NextResponse.json({
    range: { from: from.toISOString(), to: to.toISOString() },
    by,
    items: ranked.slice(0, limit),
  });
}
