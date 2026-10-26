import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { canAccessCounter, getStaffFromCookie } from "@/lib/auth";
import { MenuError, setStockQty } from "@/lib/menu";
import { audit } from "@/lib/audit";

const Body = z.object({ qty: z.number().int().min(0).max(100_000) });

// POST /api/admin/menu/items/[id]/stock
// Body: { qty: number }  — absolute stock quantity (not a delta)
//
// Updates both Postgres (MenuItem.stockQty) and Redis (stock:{counter}:{item})
// in one transaction. A cashier can restock items at their authorized counters.
export async function POST(req: Request, ctx: { params: { id: string } }) {
  const staff = getStaffFromCookie();
  if (!staff) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  if (staff.role !== "CASHIER" && staff.role !== "ADMIN") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "bad_request" }, { status: 400 });

  const item = await prisma.menuItem.findUnique({
    where: { id: ctx.params.id },
    select: { counterId: true },
  });
  if (!item) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (!canAccessCounter(staff, item.counterId)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  try {
    const { item: updated, stockRemaining } = await setStockQty(ctx.params.id, parsed.data.qty);
    audit({
      actor: { sub: staff.sub, role: staff.role, name: staff.name },
      action: "menu.item.restock",
      target: updated.id,
      details: { qty: parsed.data.qty, stockRemaining },
    });
    return NextResponse.json({
      ok: true,
      id: updated.id,
      stockQty: updated.stockQty,
      stockRemaining,
    });
  } catch (e) {
    if (e instanceof MenuError) {
      return NextResponse.json({ error: e.code }, { status: e.status });
    }
    throw e;
  }
}
