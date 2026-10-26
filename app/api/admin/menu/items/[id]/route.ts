import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { canAccessCounter, getStaffFromCookie } from "@/lib/auth";
import { getMenuItem } from "@/lib/menu";

const PatchBody = z.object({
  name: z.string().min(1).max(80).optional(),
  description: z.string().max(500).nullable().optional(),
  price: z.number().int().min(0).max(10_000_000).optional(),
  imageUrl: z.string().url().max(500).nullable().optional(),
  lowStockThreshold: z.number().int().min(0).max(1000).optional(),
  // Re-assigning an item to a different counter is supported. Both old
  // and new counter must be in the caller's allowed set; for a cashier
  // this restricts the move to their own counters.
  counterId: z.string().min(1).optional(),
});

// PATCH /api/admin/menu/items/[id]
// Edit name / description / price / image / counter assignment / threshold.
// Stock and availability changes go through their dedicated endpoints so
// the real-time event is unambiguous.
export async function PATCH(req: Request, ctx: { params: { id: string } }) {
  const staff = getStaffFromCookie();
  if (!staff) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  if (staff.role !== "CASHIER" && staff.role !== "ADMIN") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const parsed = PatchBody.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "bad_request" }, { status: 400 });

  const existing = await prisma.menuItem.findUnique({ where: { id: ctx.params.id } });
  if (!existing) return NextResponse.json({ error: "not_found" }, { status: 404 });

  // Authorization: the existing counter must be one we own (so a cashier
  // can't edit items at counters they don't manage). If the patch changes
  // the counter, the new counter must also be one we own.
  if (!canAccessCounter(staff, existing.counterId)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  if (parsed.data.counterId && parsed.data.counterId !== existing.counterId) {
    if (!canAccessCounter(staff, parsed.data.counterId)) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
  }

  // Build a partial update; undefined keys are left alone.
  const data: import("@prisma/client").Prisma.MenuItemUpdateInput = {};
  if (parsed.data.name !== undefined) data.name = parsed.data.name;
  if (parsed.data.description !== undefined) data.description = parsed.data.description;
  if (parsed.data.price !== undefined) data.price = parsed.data.price;
  if (parsed.data.imageUrl !== undefined) data.imageUrl = parsed.data.imageUrl;
  if (parsed.data.lowStockThreshold !== undefined) {
    data.lowStockThreshold = parsed.data.lowStockThreshold;
  }
  if (parsed.data.counterId !== undefined && parsed.data.counterId !== existing.counterId) {
    data.counter = { connect: { id: parsed.data.counterId } };
    // Stock moves to the new counter as a fresh key in Redis. The old key
    // is left in place; if the item is re-assigned back, the leftover
    // stock would reappear. To avoid that, set the new stock to the
    // current Redis value at the new counter (default 0) and let the
    // operator set stock explicitly if needed. We copy the previous
    // counter's stock value across.
    const { getStock, setStock } = await import("@/lib/queue");
    const movedStock = await getStock(existing.counterId, existing.id);
    await setStock(parsed.data.counterId, existing.id, movedStock);
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ ok: true, item: await getMenuItem(ctx.params.id) });
  }

  const updated = await prisma.menuItem.update({
    where: { id: existing.id },
    data,
  });
  return NextResponse.json({ ok: true, item: await getMenuItem(updated.id) });
}
