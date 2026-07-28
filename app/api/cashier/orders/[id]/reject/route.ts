import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getStaffFromCookie } from "@/lib/auth";
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
  if (order.status !== "PENDING_CASHIER") {
    return NextResponse.json({ error: "bad_state", status: order.status }, { status: 409 });
  }

  await releaseStock(
    order.counterId,
    order.items.map((it: { menuItemId: string; qty: number }) => ({
      menuItemId: it.menuItemId,
      qty: it.qty,
    })),
  );
  await dequeueOrder(order.counterId, order.id);
  const updated = await prisma.order.update({
    where: { id: order.id },
    data: { status: "REJECTED", rejectReason: reason ?? "Out of stock", completedAt: new Date() },
  });
  emitOrderStatus({
    orderId: updated.id,
    token: updated.token,
    counterId: updated.counterId,
    status: "REJECTED",
    rejectReason: updated.rejectReason ?? undefined,
  });
  return NextResponse.json({ ok: true, status: updated.status });
}