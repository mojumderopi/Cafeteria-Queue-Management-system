// Tiny in-memory rate limiter, scoped per remote address.
//
// Use only for low-traffic, dev/local endpoints. NOT cluster-safe: in a
// multi-process deploy, each worker keeps its own counter and the
// effective limit is multiplied by the worker count. For a single-node
// Next.js + custom server (this project's dev shape) it is correct.
//
// Defaults are intentionally conservative. Tune at the call site.
//
// Returned `RateResult.allow === false` carries a `retryAfterSec` hint so
// the caller can return a 429 with a sensible `Retry-After` header.

interface Bucket {
  // Tokens currently available. Floats allowed.
  tokens: number;
  // Timestamp of the last refill, ms since epoch.
  lastRefillMs: number;
}

interface BucketKey {
  route: string;
  ip: string;
}

const buckets = new Map<string, Bucket>();

interface RateOptions {
  // Bucket capacity (max tokens). Burst size.
  capacity: number;
  // Tokens added per second. Sustained rate.
  refillPerSec: number;
}

export interface RateResult {
  allow: boolean;
  retryAfterSec: number;
  remaining: number;
}

function key(k: BucketKey): string {
  return `${k.route}::${k.ip}`;
}

function remoteIp(req: Request): string {
  // x-forwarded-for is set by reverse proxies; trust the first hop only.
  const xff = req.headers.get("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }
  const real = req.headers.get("x-real-ip");
  if (real) return real;
  return "unknown";
}

export function rateLimit(req: Request, route: string, opts: RateOptions): RateResult {
  const ip = remoteIp(req);
  const k = key({ route, ip });
  const now = Date.now();
  let b = buckets.get(k);
  if (!b) {
    b = { tokens: opts.capacity, lastRefillMs: now };
    buckets.set(k, b);
  } else {
    const elapsedSec = (now - b.lastRefillMs) / 1000;
    if (elapsedSec > 0) {
      b.tokens = Math.min(opts.capacity, b.tokens + elapsedSec * opts.refillPerSec);
      b.lastRefillMs = now;
    }
  }
  if (b.tokens >= 1) {
    b.tokens -= 1;
    return { allow: true, retryAfterSec: 0, remaining: Math.floor(b.tokens) };
  }
  // Not enough tokens: estimate seconds until 1 token is available.
  const need = 1 - b.tokens;
  const retryAfterSec = Math.max(1, Math.ceil(need / opts.refillPerSec));
  return { allow: false, retryAfterSec, remaining: 0 };
}

// Test-only: clear all buckets. Not exposed in any route.
export function _resetRateLimit(): void {
  buckets.clear();
}
