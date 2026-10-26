import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { canAccessCounter, getStaffFromCookie } from "@/lib/auth";
import { archive, restore, MenuError } from "@/lib/menu";
import { audit } from "@/lib/audit";

async function gate(id: string) {
  const staff = getStaffFromCookie();
  if (!staff) return { error: NextResponse.json({ error: "forbidden" }, { status: 403 }) };
  if (staff.role !== "CASHIER" && staff.role !== "ADMIN") {
    return { error: NextResponse.json({ error: "forbidden" }, { status: 403 }) };
  }
  const item = await prisma.menuItem.findUnique({
    where: { id },
    select: { counterId: true },
  });
  if (!item) return { error: NextResponse.json({ error: "not_found" }, { status: 404 }) };
  if (!canAccessCounter(staff, item.counterId)) {
    return { error: NextResponse.json({ error: "forbidden" }, { status: 403 }) };
  }
  return { staff };
}

// POST /api/admin/menu/items/[id]/archive — soft delete
export async function POST(_req: Request, ctx: { params: { id: string } }) {
  const g = await gate(ctx.params.id);
  if ("error" in g) return g.error;
  try {
    const updated = await archive(ctx.params.id);
    audit({
      actor: { sub: g.staff.sub, role: g.staff.role, name: g.staff.name },
      action: "menu.item.archive",
      target: updated.id,
    });
    return NextResponse.json({ ok: true, id: updated.id, archived: true });
  } catch (e) {
    if (e instanceof MenuError) return NextResponse.json({ error: e.code }, { status: e.status });
    throw e;
  }
}

// DELETE /api/admin/menu/items/[id]/archive — restore
export async function DELETE(_req: Request, ctx: { params: { id: string } }) {
  const g = await gate(ctx.params.id);
  if ("error" in g) return g.error;
  try {
    const updated = await restore(ctx.params.id);
    audit({
      actor: { sub: g.staff.sub, role: g.staff.role, name: g.staff.name },
      action: "menu.item.restore",
      target: updated.id,
    });
    return NextResponse.json({ ok: true, id: updated.id, archived: false });
  } catch (e) {
    if (e instanceof MenuError) return NextResponse.json({ error: e.code }, { status: e.status });
    throw e;
  }
}
