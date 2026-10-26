import { NextResponse } from "next/server";
import { getStaffFromCookie } from "@/lib/auth";

// Returns the currently authenticated staff session. Used by the cashier
// and admin frontends to render role-appropriate navigation.
export async function GET() {
  const staff = getStaffFromCookie();
  if (!staff) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  return NextResponse.json({
    sub: staff.sub,
    role: staff.role,
    name: staff.name,
    counterIds: staff.counterIds,
  });
}
