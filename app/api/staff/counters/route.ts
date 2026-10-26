import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getStaffFromCookie } from "@/lib/auth";

/**
 * Returns the counters the calling staff member is allowed to operate on.
 * Auth required. The previous implementation was unauthenticated and
 * leaked every counter's id and slug; that has been removed.
 */
export async function GET() {
  const staff = getStaffFromCookie();
  if (!staff) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  if (staff.counterIds.length === 0) {
    return NextResponse.json({ counters: [] });
  }
  const where = staff.counterIds[0] === "*" ? {} : { id: { in: staff.counterIds } };
  const counters = await prisma.counter.findMany({
    where,
    orderBy: { name: "asc" },
    select: { id: true, slug: true, name: true },
  });
  return NextResponse.json({ counters });
}
