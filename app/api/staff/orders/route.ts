import { NextResponse } from "next/server";
import { OrderStatus, type Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { canAccessCounter, getStaffFromCookie } from "@/lib/auth";

// Default status filter when the caller doesn't pass ?status=...
const DEFAULT_STATUSES: OrderStatus[] = ["PENDING_CASHIER", "APPROVED", "PREPARING", "READY"];

// Returns pending or approved orders for the staff member's counter context.
export async function GET(req: Request) {
  const staff = getStaffFromCookie();
  if (!staff) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const url = new URL(req.url);
  const counterId = url.searchParams.get("counterId");
  const statusFilter = url.searchParams.get("status"); // csv e.g. "PENDING_CASHIER,APPROVED"

  // Enforce per-counter access. An empty counterIds list means the staff user
  // has not been assigned to any counter and gets no data. If the caller
  // passed a counterId they don't own, refuse.
  if (staff.counterIds.length === 0) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  if (counterId && !canAccessCounter(staff, counterId)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const where: Prisma.OrderWhereInput = {};
  // If the caller didn't pin a counter, restrict to the counters they own.
  if (counterId) {
    where.counterId = counterId;
  } else if (staff.counterIds[0] !== "*") {
    where.counterId = { in: staff.counterIds };
  }
  if (statusFilter) {
    const statuses: OrderStatus[] = statusFilter.split(",") as OrderStatus[];
    where.status = { in: statuses };
  } else {
    where.status = { in: DEFAULT_STATUSES };
  }

  const orders = await prisma.order.findMany({
    where,
    include: { items: { include: { menuItem: true } } },
    orderBy: [{ priorityScore: "desc" }, { createdAt: "asc" }],
    take: 100,
  });

  return NextResponse.json({
    orders: orders.map((o) => ({
      id: o.id,
      token: o.token,
      counterId: o.counterId,
      status: o.status,
      paymentStatus: o.paymentStatus,
      totalCents: o.totalCents,
      priorityScore: o.priorityScore,
      createdAt: o.createdAt,
      approvedAt: o.approvedAt,
      readyAt: o.readyAt,
      guestPhone: o.guestPhone,
      items: o.items.map((it) => ({
        menuItemId: it.menuItemId,
        name: it.menuItem.name,
        qty: it.qty,
        unitPrice: it.unitPrice,
      })),
    })),
  });
}
