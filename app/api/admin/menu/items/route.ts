import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { canAccessCounter, getStaffFromCookie } from "@/lib/auth";
import { listMenu } from "@/lib/menu";
import { setStock } from "@/lib/queue";
import { audit } from "@/lib/audit";

// GET /api/admin/menu/items?counterId=...&q=...&includeArchived=true|false
// Returns the menu items the caller is allowed to see, with authoritative
// stock from Redis. ADMIN sees all counters; CASHIER sees only assigned
// counters (even if a specific counterId is requested, we still verify).
export async function GET(req: Request) {
  const staff = getStaffFromCookie();
  if (!staff) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  if (staff.role !== "CASHIER" && staff.role !== "ADMIN") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const url = new URL(req.url);
  const counterId = url.searchParams.get("counterId");
  const q = url.searchParams.get("q") ?? undefined;
  const includeArchived = url.searchParams.get("includeArchived") === "true";

  // Decide which counter IDs the caller is allowed to see. If the caller
  // requested a specific counter, they must own it.
  let allowed: string[] | undefined;
  if (staff.counterIds[0] === "*") {
    allowed = undefined; // admin: no restriction
  } else {
    allowed = staff.counterIds;
  }
  if (counterId && allowed && !allowed.includes(counterId)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const items = await listMenu({
    counterIds: counterId ? [counterId] : allowed,
    q,
    includeArchived,
  });

  return NextResponse.json({
    items: items.map((it) => ({
      id: it.id,
      counterId: it.counterId,
      name: it.name,
      description: it.description,
      price: it.price,
      isAvailable: it.isAvailable,
      stockQty: it.stockQty,
      stockRemaining: it.stockRemaining,
      lowStockThreshold: it.lowStockThreshold,
      imageUrl: it.imageUrl,
      archived: !!it.archivedAt,
      createdAt: it.createdAt,
      updatedAt: it.updatedAt,
    })),
  });
}

const CreateBody = z.object({
  counterId: z.string().min(1),
  name: z.string().min(1).max(80),
  description: z.string().max(500).optional(),
  price: z.number().int().min(0).max(10_000_000),
  stockQty: z.number().int().min(0).max(100_000).default(0),
  lowStockThreshold: z.number().int().min(0).max(1000).default(3),
  isAvailable: z.boolean().default(true),
  imageUrl: z.string().url().max(500).optional(),
});

// POST /api/admin/menu/items
// Create a new item. CASHIER may only create items for their assigned
// counters; ADMIN may create for any counter. The new item is pushed to
// Redis with the requested stock so the order API sees it immediately.
export async function POST(req: Request) {
  const staff = getStaffFromCookie();
  if (!staff) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  if (staff.role !== "CASHIER" && staff.role !== "ADMIN") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const parsed = CreateBody.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "bad_request", issues: parsed.error.issues }, { status: 400 });
  }
  const data = parsed.data;

  if (!canAccessCounter(staff, data.counterId)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const counter = await prisma.counter.findUnique({ where: { id: data.counterId } });
  if (!counter) return NextResponse.json({ error: "counter_not_found" }, { status: 404 });

  const item = await prisma.menuItem.create({
    data: {
      counterId: data.counterId,
      name: data.name,
      description: data.description ?? null,
      price: data.price,
      stockQty: data.stockQty,
      lowStockThreshold: data.lowStockThreshold,
      isAvailable: data.isAvailable,
      imageUrl: data.imageUrl ?? null,
    },
  });
  await setStock(item.counterId, item.id, data.stockQty);
  audit({
    actor: { sub: staff.sub, role: staff.role, name: staff.name },
    action: "menu.item.create",
    target: item.id,
    details: { counterId: item.counterId, name: item.name, stockQty: data.stockQty },
  });

  return NextResponse.json({
    ok: true,
    item: {
      id: item.id,
      counterId: item.counterId,
      name: item.name,
      price: item.price,
      isAvailable: item.isAvailable,
      stockQty: item.stockQty,
      stockRemaining: data.stockQty,
      archived: false,
    },
  });
}
