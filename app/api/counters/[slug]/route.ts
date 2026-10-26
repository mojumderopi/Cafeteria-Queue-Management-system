import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getStocks } from "@/lib/queue";

// Public menu for a counter. Hides archived items (soft-deleted) and
// combines the manual availability flag with the authoritative Redis
// stock. The order API still does its own validation against the
// database, so the public shape is for display only.
export async function GET(_req: Request, ctx: { params: { slug: string } }) {
  const counter = await prisma.counter.findUnique({ where: { slug: ctx.params.slug } });
  if (!counter) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const items = await prisma.menuItem.findMany({
    where: { counterId: counter.id, archivedAt: null },
    orderBy: { name: "asc" },
  });
  const ids = items.map((i) => i.id);
  const stocks = await getStocks(counter.id, ids);

  // The combined public availability flag (manual + stock>0). The
  // cashier UI sees the separate fields via /api/admin/menu/items.
  const menu = items.map((it) => ({
    id: it.id,
    name: it.name,
    description: it.description,
    price: it.price,
    isAvailable: it.isAvailable && stocks[it.id] > 0,
    stockRemaining: stocks[it.id],
    lowStockThreshold: it.lowStockThreshold,
    imageUrl: it.imageUrl,
  }));

  return NextResponse.json({
    counter: { id: counter.id, slug: counter.slug, name: counter.name },
    menu,
  });
}
