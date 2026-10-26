import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { canAccessCounter, getStaffFromCookie } from "@/lib/auth";
import { MenuError, setAvailability } from "@/lib/menu";
import { audit } from "@/lib/audit";

const Body = z.object({ isAvailable: z.boolean() });

// POST /api/admin/menu/items/[id]/availability
// Body: { isAvailable: boolean }
//
// Cashier (counter-scoped) or admin can flip the manual availability flag.
// Stock is intentionally NOT changed here; restocking is a separate action.
export async function POST(req: Request, ctx: { params: { id: string } }) {
  const staff = getStaffFromCookie();
  if (!staff) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  if (staff.role !== "CASHIER" && staff.role !== "ADMIN") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "bad_request" }, { status: 400 });

  // Authorization: the item must belong to a counter the staff user owns.
  const item = await prisma.menuItem.findUnique({
    where: { id: ctx.params.id },
    select: { counterId: true },
  });
  if (!item) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (!canAccessCounter(staff, item.counterId)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  try {
    const updated = await setAvailability(ctx.params.id, parsed.data.isAvailable);
    audit({
      actor: { sub: staff.sub, role: staff.role, name: staff.name },
      action: "menu.item.availability",
      target: updated.id,
      details: { isAvailable: parsed.data.isAvailable },
    });
    return NextResponse.json({
      ok: true,
      id: updated.id,
      isAvailable: updated.isAvailable,
    });
  } catch (e) {
    if (e instanceof MenuError) {
      return NextResponse.json({ error: e.code }, { status: e.status });
    }
    throw e;
  }
}
