import Redis from "ioredis";

declare global {
  // eslint-disable-next-line no-var
  var __redis: Redis | undefined;
}

const url = process.env.REDIS_URL ?? "redis://localhost:6379";

export const redis: Redis =
  global.__redis ??
  new Redis(url, {
    maxRetriesPerRequest: 3,
    enableReadyCheck: true,
  });

if (process.env.NODE_ENV !== "production") {
  global.__redis = redis;
}

// Key helpers — keep them in one place so Lua and TS agree.
export const k = {
  stock: (counterId: string, itemId: string) => `stock:${counterId}:${itemId}`,
  queue: (counterId: string) => `queue:${counterId}`,
  priority: (counterId: string) => `priority:${counterId}`,
  lockOrder: (orderId: string) => `lock:order:${orderId}`,
  ticketCounter: (counterId: string) => `ticketCounter:${counterId}`,
};