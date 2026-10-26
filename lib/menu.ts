// Authoritative menu-state helpers. Centralized so the cashier and admin
// APIs cannot drift from each other, and so the real-time emitter and
// Redis sync are always invoked together.
//
// Concurrent-safety rules:
//   - PostgreSQL MenuItem is the source of truth for the manual flag and
//     price/name/description.
//   - Redis `stock:{counter}:{item}` is the source of truth for the
//     current running stock, written via Lua reserveStock / releaseStock
//     during the order lifecycle, and via setStock() during restock.
//   - We never overwrite a newer Redis value with a stale DB read.
//
// NOTE on soft-delete: the `archivedAt` column is added by migration
// `20261012000000_menu_archive_and_updated_at` (see prisma/migrations/).
// Until the migration is applied, `findItem` returns a MenuItem without
// that field, so `item.archivedAt` is undefined and the `if (archived)` paths
// are skipped. Once the migration is run, the same code paths will gate
// writes correctly. This avoids requiring the operator to apply the
// migration before they can use any of the rest of this module.
import { prisma } from "./prisma";
import { getStock, getStocks, setStock } from "./queue";
import { emitMenuAvailability } from "./bus";
import { Prisma, type MenuItem } from "@prisma/client";

export class MenuError extends Error {
  status: number;
  code: string;
  constructor(code: string, message: string, status: number) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

type ItemWithArchive = MenuItem & { archivedAt?: Date | null };

function isArchived(item: ItemWithArchive): boolean {
  return !!item.archivedAt;
}

async function findItem(id: string): Promise<ItemWithArchive> {
  const item = await prisma.menuItem.findUnique({ where: { id } });
  if (!item) throw new MenuError("not_found", "Menu item not found", 404);
  return item as ItemWithArchive;
}

export async function setAvailability(
  id: string,
  isAvailable: boolean,
): Promise<MenuItem> {
  const item = await findItem(id);
  if (isArchived(item)) {
    throw new MenuError("archived", "Cannot change availability of an archived item", 409);
  }
  const updated = await prisma.menuItem.update({
    where: { id: item.id },
    data: { isAvailable },
  });
  const stockRemaining = await getStock(item.counterId, item.id);
  emitMenuAvailability({
    counterId: item.counterId,
    itemId: item.id,
    isAvailable: updated.isAvailable,
    stockRemaining,
    archived: false,
    updatedAt: new Date().toISOString(),
  });
  return updated;
}

// Set absolute stock quantity. Updates Postgres MenuItem.stockQty AND
// Redis stock:{counter}:{item}.
export async function setStockQty(
  id: string,
  qty: number,
): Promise<{ item: MenuItem; stockRemaining: number }> {
  if (!Number.isInteger(qty) || qty < 0) {
    throw new MenuError("bad_request", "Stock quantity must be a non-negative integer", 400);
  }
  const item = await findItem(id);
  if (isArchived(item)) {
    throw new MenuError("archived", "Cannot restock an archived item", 409);
  }
  const updated = await prisma.menuItem.update({
    where: { id: item.id },
    data: { stockQty: qty },
  });
  const stockRemaining = await setStock(item.counterId, item.id, qty);
  emitMenuAvailability({
    counterId: item.counterId,
    itemId: item.id,
    isAvailable: updated.isAvailable,
    stockRemaining,
    archived: false,
    updatedAt: new Date().toISOString(),
  });
  return { item: updated, stockRemaining };
}

// List menu items for one or all counters, including authoritative stock
// from Redis. Honors the soft-delete column when present. When the column
// is missing (migration not yet applied), archived is treated as false
// for every item.
export async function listMenu(opts: {
  counterIds?: string[];
  q?: string;
  includeArchived?: boolean;
  take?: number;
}): Promise<Array<ItemWithArchive & { stockRemaining: number }>> {
  const where: Prisma.MenuItemWhereInput = {};
  if (opts.counterIds && opts.counterIds.length > 0) where.counterId = { in: opts.counterIds };
  if (opts.q && opts.q.trim()) {
    const q = opts.q.trim();
    where.OR = [
      { name: { contains: q, mode: "insensitive" } },
      { description: { contains: q, mode: "insensitive" } },
    ];
  }
  const items = (await prisma.menuItem.findMany({
    where,
    orderBy: [{ counterId: "asc" }, { name: "asc" }],
    take: opts.take ?? 200,
  })) as ItemWithArchive[];
  if (items.length === 0) return [];
  if (!opts.includeArchived) {
    // JavaScript-side filter; safe because the column is a nullable date.
    const filtered = items.filter((it) => !isArchived(it));
    return fillStocks(filtered);
  }
  return fillStocks(items);
}

async function fillStocks(
  items: ItemWithArchive[],
): Promise<Array<ItemWithArchive & { stockRemaining: number }>> {
  const byCounter = new Map<string, ItemWithArchive[]>();
  for (const it of items) {
    const arr = byCounter.get(it.counterId) ?? [];
    arr.push(it);
    byCounter.set(it.counterId, arr);
  }
  const stocks = new Map<string, number>();
  for (const [counterId, arr] of byCounter) {
    const r = await getStocks(counterId, arr.map((i) => i.id));
    for (const [id, n] of Object.entries(r)) stocks.set(id, n);
  }
  return items.map((it) => ({ ...it, stockRemaining: stocks.get(it.id) ?? 0 }));
}

export async function getMenuItem(
  id: string,
): Promise<(ItemWithArchive & { stockRemaining: number }) | null> {
  const item = (await prisma.menuItem.findUnique({ where: { id } })) as ItemWithArchive | null;
  if (!item) return null;
  const stockRemaining = await getStock(item.counterId, item.id);
  return { ...item, stockRemaining };
}

// Soft-archive. Idempotent: archiving an already-archived item is a no-op
// (returns the existing row).
export async function archive(id: string): Promise<MenuItem> {
  const item = await findItem(id);
  if (isArchived(item)) return item;
  const updated = (await prisma.menuItem.update({
    where: { id: item.id },
    data: { archivedAt: new Date() as unknown as null },
    // Prisma 5 supports optional `archivedAt` only when the schema field
    // is present. If the column is missing in the DB, this update will
    // throw at runtime; the route handler will surface a 500. The
    // migration adds the column before this path is exercised.
  })) as MenuItem;
  emitMenuAvailability({
    counterId: item.counterId,
    itemId: item.id,
    isAvailable: updated.isAvailable,
    stockRemaining: 0,
    archived: true,
    updatedAt: new Date().toISOString(),
  });
  return updated;
}

export async function restore(id: string): Promise<MenuItem> {
  const item = await findItem(id);
  const updated = (await prisma.menuItem.update({
    where: { id: item.id },
    data: { archivedAt: null },
  })) as MenuItem;
  const stockRemaining = await getStock(item.counterId, item.id);
  emitMenuAvailability({
    counterId: item.counterId,
    itemId: item.id,
    isAvailable: updated.isAvailable,
    stockRemaining,
    archived: false,
    updatedAt: new Date().toISOString(),
  });
  return updated;
}

// Helper for callers (e.g. the counters slug API) that need to know
// whether a given item is archived. Cheap because it's a single property
// read on an already-loaded row.
export { isArchived };
