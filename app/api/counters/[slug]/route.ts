import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getStocks } from "@/lib/queue";

export async function GET(_req: Request, ctx: { params: { slug: string } }) {
  const counter = await prisma.counter.findUnique({ where: { slug: ctx.params.slug } });
  if (!counter) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const items = await prisma.menuItem.findMany({
    where: { counterId: counter.id },
    orderBy: { name: "asc" },
  });
  const ids = items.map((i) => i.id);
  const stocks = await getStocks(counter.id, ids);

  // getStocks() always returns a number (0 on miss), so trust Redis as the
  // source of truth. The MenuItem.stockQty is only used at seed time.
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