import { NextResponse } from "next/server";
import { OrderStatus, PaymentStatus, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getStaffFromCookie } from "@/lib/auth";

// GET /api/admin/analytics/overview?from=ISO&to=ISO
// Aggregate sales metrics for the requested window.
//
// Revenue definition: a qualifying sale is an Order with
//   status = COMPLETED AND paymentStatus = PAID
// Excludes REJECTED, CANCELLED, and any non-completed state. Avoids
// double-counting because every order has at most one such terminal state.
// "Items sold" is summed from OrderItem.qty over the same qualifying
// order set. "Pending" counts PENDING_CASHIER + APPROVED + PREPARING + READY
// regardless of date — they're today's live queue.
const QUALIFYING_STATUSES: OrderStatus[] = ["COMPLETED"];
const PENDING_STATUSES: OrderStatus[] = ["PENDING_CASHIER", "APPROVED", "PREPARING", "READY"];

function parseRange(url: URL) {
  const now = new Date();
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  const from = url.searchParams.get("from")
    ? new Date(url.searchParams.get("from")!)
    : startOfToday;
  const to = url.searchParams.get("to")
    ? new Date(url.searchParams.get("to")!)
    : new Date(now.getTime() + 60_000);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
    return null;
  }
  return { from, to };
}

export async function GET(req: Request) {
  const staff = getStaffFromCookie();
  if (!staff) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  if (staff.role !== "ADMIN") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const url = new URL(req.url);
  const range = parseRange(url);
  if (!range) return NextResponse.json({ error: "bad_request" }, { status: 400 });
  const { from, to } = range;

  // Pending is a real-time count, not bound to the date range.
  const pendingCount = await prisma.order.count({
    where: { status: { in: PENDING_STATUSES } },
  });

  // Qualifying sales: completed + paid, completedAt in window.
  const qualifyingWhere: Prisma.OrderWhereInput = {
    status: { in: QUALIFYING_STATUSES },
    paymentStatus: PaymentStatus.PAID,
    completedAt: { gte: from, lte: to },
  };
  const totals = await prisma.order.aggregate({
    where: qualifyingWhere,
    _sum: { totalCents: true },
    _count: { _all: true },
  });
  // Items sold: query OrderItem joined on the qualifying Order set.
  const itemSum = await prisma.orderItem.aggregate({
    where: { order: qualifyingWhere },
    _sum: { qty: true },
  });
  const salesCents = totals._sum.totalCents ?? 0;
  const completedOrders = totals._count._all;
  const itemsSold = itemSum._sum.qty ?? 0;
  const avgOrderCents = completedOrders > 0 ? Math.round(salesCents / completedOrders) : 0;

  return NextResponse.json({
    range: { from: from.toISOString(), to: to.toISOString() },
    salesCents,
    completedOrders,
    pendingOrders: pendingCount,
    itemsSold,
    avgOrderCents,
  });
}
