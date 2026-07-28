// Thin wrappers around the Lua scripts. Keeps callers from poking at Redis directly.
import { redis, k } from "./redis";
import { luaScripts, luaShas } from "./lua/scripts";

let loaded = false;

async function ensureLoaded() {
  if (loaded) return;
  for (const key of Object.keys(luaScripts) as (keyof typeof luaScripts)[]) {
    const sha = await redis.script("LOAD", luaScripts[key]) as string;
    luaShas[key] = sha;
  }
  loaded = true;
}

async function callLua<T = unknown>(name: keyof typeof luaScripts, keys: string[], args: (string | number)[]): Promise<T> {
  await ensureLoaded();
  const sha = luaShas[name];
  try {
    const res = await redis.evalsha(sha, keys.length, ...keys, ...args);
    return res as T;
  } catch (err) {
    // Redis returns NOSCRIPT if flushed — reload and retry once.
    const msg = (err as Error).message ?? "";
    if (msg.includes("NOSCRIPT")) {
      loaded = false;
      await ensureLoaded();
      const res = await redis.evalsha(luaShas[name], keys.length, ...keys, ...args);
      return res as T;
    }
    throw err;
  }
}

export type ReserveOk = [1, ...number[]]; // [1, remaining1, remaining2, ...]
export type ReserveFail = [0, number]; // [0, shortIndex]

export async function reserveStock(
  counterId: string,
  lines: { menuItemId: string; qty: number }[],
): Promise<{ ok: true; remaining: number[] } | { ok: false; shortIndex: number }> {
  const keys = lines.map((l) => k.stock(counterId, l.menuItemId));
  const args = lines.map((l) => l.qty);
  const res = (await callLua("reserveStock", keys, args)) as ReserveOk | ReserveFail;
  if (res[0] === 1) {
    return { ok: true, remaining: res.slice(1) as number[] };
  }
  return { ok: false, shortIndex: res[1] };
}

export async function releaseStock(
  counterId: string,
  lines: { menuItemId: string; qty: number }[],
): Promise<number[]> {
  const keys = lines.map((l) => k.stock(counterId, l.menuItemId));
  const args = lines.map((l) => l.qty);
  return (await callLua("releaseStock", keys, args)) as number[];
}

export async function enqueueOrder(counterId: string, orderId: string, score: number): Promise<void> {
  await callLua("enqueue", [k.queue(counterId), k.priority(counterId)], [orderId, score]);
}

export async function dequeueOrder(counterId: string, orderId: string): Promise<void> {
  // count=1 removes at most one match. Combined with the idempotent enqueue.lua,
  // this guarantees we never silently drop an unrelated order from the queue.
  await redis.lrem(k.queue(counterId), 1, orderId);
  await redis.zrem(k.priority(counterId), orderId);
}

export async function promoteOldOrders(counterId: string): Promise<string[]> {
  const now = Date.now();
  const ageMs = 90_000; // anything waiting > 90s
  const boost = 50; // bigger than typical new-order score drift
  return (await callLua("promote", [k.priority(counterId)], [now, ageMs, boost])) as string[];
}

export async function listQueuedOrderIds(counterId: string): Promise<string[]> {
  // Reverse so newest is first; kitchen UI uses createdAt for tiebreak.
  return (await redis.lrange(k.queue(counterId), 0, -1)) as string[];
}

export async function setStockFromDb(counterId: string, items: { id: string; stockQty: number }[]): Promise<void> {
  if (items.length === 0) return;
  const pipe = redis.pipeline();
  for (const it of items) {
    pipe.set(k.stock(counterId, it.id), it.stockQty);
  }
  const results = await pipe.exec();
  if (!results) throw new Error("setStockFromDb: Redis pipeline returned no results");
  for (const [err] of results) if (err) throw err;
}

export async function getStocks(counterId: string, itemIds: string[]): Promise<Record<string, number>> {
  if (itemIds.length === 0) return {};
  const keys = itemIds.map((id) => k.stock(counterId, id));
  const values = await redis.mget(...keys);
  const out: Record<string, number> = {};
  itemIds.forEach((id, i) => {
    const v = values[i];
    out[id] = typeof v === "string" ? parseInt(v, 10) || 0 : 0;
  });
  return out;
}

export async function nextToken(counterId: string): Promise<string> {
  const n = await redis.incr(k.ticketCounter(counterId));
  const letter = String.fromCharCode(65 + ((n - 1) % 26));
  return `${letter}-${n.toString().padStart(3, "0")}`;
}