import { NextResponse } from "next/server";
import type { MenuItem } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { reserveStock, enqueueOrder, nextToken, getStocks } from "@/lib/queue";
import { getOrCreateGuestId } from "@/lib/auth";
import { emitOrderNew, emitStockLow } from "@/lib/bus";

const Line = z.object({ menuItemId: z.string().min(1), qty: z.number().int().positive().max(20) });

const Body = z.object({
  counterSlug: z.string().min(1),
  items: z.array(Line).min(1).max(20),
  guestPhone: z.string().min(6).max(20).optional(),
  guestName: z.string().max(60).optional(),
});

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "bad_request", issues: parsed.error.issues }, { status: 400 });

  const { counterSlug, items, guestPhone, guestName } = parsed.data;
  const counter = await prisma.counter.findUnique({ where: { slug: counterSlug } });
  if (!counter) return NextResponse.json({ error: "counter_not_found" }, { status: 404 });

  // Validate every item belongs to this counter and is currently available.
  const menuItems: MenuItem[] = await prisma.menuItem.findMany({
    where: { id: { in: items.map((i) => i.menuItemId) }, counterId: counter.id },
  });
  const menuById = new Map<string, MenuItem>(menuItems.map((m) => [m.id, m]));
  for (const line of items) {
    const m = menuById.get(line.menuItemId);
    if (!m || !m.isAvailable) {
      return NextResponse.json(
        { error: "item_unavailable", menuItemId: line.menuItemId, name: m?.name ?? null },
        { status: 409 },
      );
    }
  }

  // Atomic stock reservation — all-or-nothing.
  const reserve = await reserveStock(
    counter.id,
    items.map((i) => ({ menuItemId: i.menuItemId, qty: i.qty })),
  );
  if (!reserve.ok) {
    const shortId = items[reserve.shortIndex]?.menuItemId;
    return NextResponse.json(
      { error: "stock_short", shortItemId: shortId, items: items.map((i) => i.menuItemId) },
      { status: 409 },
    );
  }

  // Emit low-stock warnings.
  const fresh = await getStocks(counter.id, items.map((i) => i.menuItemId));
  for (const line of items) {
    const remain = fresh[line.menuItemId] ?? 0;
    const m = menuById.get(line.menuItemId);
    if (m && remain <= m.lowStockThreshold) {
      emitStockLow({ counterId: counter.id, menuItemId: line.menuItemId, remaining: remain });
    }
  }

  // Persist the order.
  const token = await nextToken(counter.id);
  const totalCents = items.reduce((sum, line) => sum + (menuById.get(line.menuItemId)!.price * line.qty), 0);
  const guestId = getOrCreateGuestId();

  // Optional: upgrade guest to a student account if phone + name provided.
  // Scoped to STUDENT role so a guest can't reuse a cashier/kitchen/admin phone
  // and have their order attributed to a staff account.
  let userId: string | undefined;
  if (guestPhone) {
    const existing = await prisma.user.findFirst({ where: { phone: guestPhone, role: "STUDENT" } });
    userId =
      existing?.id ??
      (
        await prisma.user.create({
          data: { phone: guestPhone, name: guestName ?? null, role: "STUDENT" },
        })
      ).id;
  }

  const order = await prisma.order.create({
    data: {
      token,
      counterId: counter.id,
      userId,
      guestPhone: guestPhone ?? null,
      totalCents,
      status: "PENDING_CASHIER",
      paymentStatus: "UNPAID",
      priorityScore: Date.now(),
      items: {
        create: items.map((line) => ({
          menuItemId: line.menuItemId,
          qty: line.qty,
          unitPrice: menuById.get(line.menuItemId)!.price,
        })),
      },
    },
    include: { items: true },
  });

  await enqueueOrder(counter.id, order.id, order.priorityScore);

  emitOrderNew({
    orderId: order.id,
    token: order.token,
    counterId: counter.id,
    totalCents: order.totalCents,
    priorityScore: order.priorityScore,
  });

  return NextResponse.json({
    ok: true,
    order: {
      id: order.id,
      token: order.token,
      status: order.status,
      paymentStatus: order.paymentStatus,
      totalCents: order.totalCents,
      items: order.items.map((it: { menuItemId: string; qty: number; unitPrice: number }) => ({
        menuItemId: it.menuItemId,
        qty: it.qty,
        unitPrice: it.unitPrice,
      })),
    },
    guestId,
  });
}