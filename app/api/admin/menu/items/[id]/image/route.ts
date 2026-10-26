import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { canAccessCounter, getStaffFromCookie } from "@/lib/auth";
import { UploadError, storeImage } from "@/lib/storage";
import { rateLimit } from "@/lib/ratelimit";

// POST /api/admin/menu/items/[id]/image
// multipart/form-data: field name "file" with the image.
// Returns { ok, imageUrl } or a structured error.
//
// Storage backend is chosen by lib/storage:
//   - If MENU_UPLOAD_S3_* is set, the image is uploaded to S3.
//   - Otherwise, in production, the request fails with 503 storage_not_configured.
//   - In development, the image is written to public/uploads/menu/ and
//     served as a static asset.
export async function POST(req: Request, ctx: { params: { id: string } }) {
  // Per-IP upload throttle: 3 burst, refill 1 per ~20s (3/min sustained).
  // The actual upload is bounded by staff role + per-counter access; this
  // throttle just prevents a single staff client from flooding the bucket.
  const rl = rateLimit(req, "POST /api/admin/menu/items/:id/image", { capacity: 3, refillPerSec: 1 / 20 });
  if (!rl.allow) {
    return NextResponse.json(
      { error: "rate_limited", retryAfterSec: rl.retryAfterSec },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } },
    );
  }

  const staff = getStaffFromCookie();
  if (!staff) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  if (staff.role !== "CASHIER" && staff.role !== "ADMIN") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const item = await prisma.menuItem.findUnique({
    where: { id: ctx.params.id },
    select: { counterId: true },
  });
  if (!item) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (!canAccessCounter(staff, item.counterId)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "missing_file" }, { status: 400 });
  }

  let stored;
  try {
    stored = await storeImage(file);
  } catch (e) {
    if (e instanceof UploadError) {
      return NextResponse.json({ error: e.code, message: e.message }, { status: e.status });
    }
    throw e;
  }

  await prisma.menuItem.update({
    where: { id: ctx.params.id },
    data: { imageUrl: stored.url },
  });
  return NextResponse.json({ ok: true, imageUrl: stored.url });
}
