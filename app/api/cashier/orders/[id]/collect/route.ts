import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { canAccessCounter, getStaffFromCookie } from "@/lib/auth";
import { emitOrderStatus } from "@/lib/bus";

const Body = z.object({ token: z.string().min(1) });

export async function POST(req: Request, ctx: { params: { id: string } }) {
  const staff = getStaffFromCookie();
  if (!staff || (staff.role !== "CASHIER" && staff.role !== "ADMIN")) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "bad_request" }, { status: 400 });

  const order = await prisma.order.findUnique({ where: { id: ctx.params.id } });
  if (!order) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (!canAccessCounter(staff, order.counterId)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  if (order.token.toUpperCase() !== parsed.data.token.toUpperCase()) {
    return NextResponse.json({ error: "token_mismatch" }, { status: 400 });
  }
  if (order.status !== "READY") {
    return NextResponse.json({ error: "bad_state", status: order.status }, { status: 409 });
  }

  // Atomic conditional update so two concurrent collect requests (e.g. a
  // network retry) cannot both flip the order to COMPLETED.
  const updated = await prisma.order.updateMany({
    where: { id: order.id, status: "READY" },
    data: { status: "COMPLETED", paymentStatus: "PAID", completedAt: new Date() },
  });
  if (updated.count === 0) {
    return NextResponse.json({ error: "bad_state" }, { status: 409 });
  }
  emitOrderStatus({
    orderId: order.id,
    token: order.token,
    counterId: order.counterId,
    status: "COMPLETED",
  });
  return NextResponse.json({ ok: true, status: "COMPLETED", paymentStatus: "PAID" });
}