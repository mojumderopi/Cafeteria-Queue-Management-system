import { NextResponse } from "next/server";
import { OrderStatus, type Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getStaffFromCookie } from "@/lib/auth";

// Default status filter when the caller doesn't pass ?status=...
const DEFAULT_STATUSES: OrderStatus[] = ["PENDING_CASHIER", "APPROVED", "PREPARING", "READY"];

// Returns pending or approved orders for the staff member's counter context.
export async function GET(req: Request) {
  const staff = getStaffFromCookie();
  if (!staff) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const url = new URL(req.url);
  const counterId = url.searchParams.get("counterId");
  const statusFilter = url.searchParams.get("status"); // csv e.g. "PENDING_CASHIER,APPROVED"

  const where: Prisma.OrderWhereInput = {};
  if (counterId) where.counterId = counterId;
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