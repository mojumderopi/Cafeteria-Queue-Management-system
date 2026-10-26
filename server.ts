// Custom Next.js + Socket.IO server. Single port, single process.
// Run with: npm run dev (or `npm start` for production after `next build`).
import { createServer } from "node:http";
import next from "next";
import { Server as IOServer } from "socket.io";
import { setIo } from "./lib/bus";
import { startPromoter } from "./lib/promoter";
import { ROOMS } from "./lib/socket-events";
import { canAccessCounter, verifyStaff, verifyOrderToken } from "./lib/auth";
import { prisma } from "./lib/prisma";

const dev = process.env.NODE_ENV !== "production";
const port = Number(process.env.PORT ?? 3000);
const hostname = process.env.HOSTNAME ?? "0.0.0.0";

/** Parse a `Cookie` header into a flat key=value map (no duplicate handling). */
function parseCookies(header: string | undefined): Record<string, string> {
  if (!header) return {};
  const out: Record<string, string> = {};
  for (const seg of header.split(";")) {
    const i = seg.indexOf("=");
    if (i < 0) continue;
    const k = seg.slice(0, i).trim();
    const v = seg.slice(i + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  }
  return out;
}

// Startup environment check. Validates the minimum required variables
// for a non-dev environment. Never prints the values themselves, only
// whether each one is set and the source it came from.
function checkRequiredEnv(): void {
  if (dev) return;
  const required: Array<[name: string, hint: string]> = [
    ["SESSION_SECRET", "must be set to a long random string in production"],
    ["DATABASE_URL", "must be set to a PostgreSQL connection string"],
    ["REDIS_URL", "must be set to a Redis connection string"],
  ];
  const missing = required.filter(([n]) => !process.env[n] || process.env[n]!.length === 0);
  if (missing.length > 0) {
    for (const [n, hint] of missing) {
      console.error(`[smart-queue] FATAL: ${n} not set; ${hint}`);
    }
    process.exit(1);
  }
  // Warn if a weak / dev secret is in use in production.
  if ((process.env.SESSION_SECRET ?? "").toLowerCase().includes("dev-secret")) {
    console.error("[smart-queue] FATAL: SESSION_SECRET appears to be the dev default; refusing to start");
    process.exit(1);
  }
}
function resolveCorsOrigins(): string[] | true {
  const explicit = (process.env.SOCKETIO_CORS_ORIGINS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  if (dev) {
    // In development, allow any origin so phones, emulators, and dev
    // tunnels work without extra configuration. `credentials: true` is
    // safe here because the dev cookies are short-lived and the
    // browser is generally on the developer's machine.
    return explicit.length > 0 ? explicit : true;
  }
  // In production, only the configured allowlist. Always include the
  // app's own origin if known.
  const ownOrigin = process.env.APP_ORIGIN ? [process.env.APP_ORIGIN] : [];
  return [...ownOrigin, ...explicit];
}

async function main() {
  checkRequiredEnv();

  const app = next({ dev, hostname, port });
  const handle = app.getRequestHandler();
  await app.prepare();

  const httpServer = createServer((req, res) => handle(req, res));

  const io = new IOServer(httpServer, {
    path: "/api/socketio",
    cors: {
      origin: resolveCorsOrigins(),
      credentials: true,
    },
  });

  io.on("connection", (socket) => {
    // Resolve identity once per connection. We deliberately do not require any
    // cookie to connect (so static assets / health checks still work), but
    // room joins are gated below.
    const cookies = parseCookies(socket.handshake.headers.cookie);
    const staffSession = verifyStaff(cookies.staff);
    // Back-compat fill: the new payload carries counterIds; older cookies may not.
    if (staffSession && !Array.isArray(staffSession.counterIds)) {
      staffSession.counterIds = [];
    }
    const hasGuest = typeof cookies.guest_id === "string" && cookies.guest_id.length > 0;

    // join:order — students (guest_id cookie) and staff can subscribe to a
    // single order's room. The room is per-order, so the join must prove
    // the requester is authorized to see THAT order:
    //   (a) a valid signed tracking token bound to the requested orderId,
    //       OR
    //   (b) a staff cookie that can access the order's counter.
    //
    // The previous version only required a guest_id cookie and accepted
    // any orderId; a logged-in guest could enumerate room names. The
    // tracking token is bound to the orderId inside the HMAC, so it
    // cannot be replayed against a different order. The token is never
    // logged; we only log the join result (allowed / denied).
    socket.on(
      "join:order",
      async (
        payload: { orderId?: unknown; token?: unknown } | unknown,
        ack?: (res: { ok: boolean; reason?: string }) => void,
      ) => {
        const orderId =
          payload && typeof payload === "object" && "orderId" in payload
            ? (payload as { orderId?: unknown }).orderId
            : (payload as unknown);
        const token =
          payload && typeof payload === "object" && "token" in payload
            ? (payload as { token?: unknown }).token
            : undefined;
        if (typeof orderId !== "string" || !orderId) {
          if (ack) ack({ ok: false, reason: "bad_request" });
          return;
        }
        const hasToken =
          typeof token === "string" && verifyOrderToken(orderId, token);
        if (!hasToken) {
          // Fall back to staff: only allowed if the staff can access
          // the order's counter. We look the counterId up in Postgres.
          if (!staffSession) {
            if (ack) ack({ ok: false, reason: "forbidden" });
            return;
          }
          const order = await prisma.order
            .findUnique({ where: { id: orderId }, select: { counterId: true } })
            .catch(() => null);
          if (!order || !canAccessCounter(staffSession, order.counterId)) {
            if (ack) ack({ ok: false, reason: "forbidden" });
            return;
          }
        }
        socket.join(ROOMS.student(orderId));
        if (ack) ack({ ok: true });
      },
    );

    // join:counter — only staff with a valid cookie for that counter may
    // join the staff-side rooms. This prevents a student from tapping the
    // live cashier/kitchen feed of any counter.
    socket.on("join:counter", (counterId: unknown) => {
      if (typeof counterId !== "string" || !counterId) return;
      if (!staffSession) return;
      if (!canAccessCounter(staffSession, counterId)) return;
      // The role determines which rooms the staff member is allowed in.
      const role = staffSession.role;
      if (role === "CASHIER" || role === "ADMIN") {
        socket.join(ROOMS.cashier(counterId));
        socket.join(ROOMS.counter(counterId));
      }
      if (role === "KITCHEN" || role === "ADMIN") {
        socket.join(ROOMS.kitchen(counterId));
        socket.join(ROOMS.counter(counterId));
      }
    });

    // join:menu — public room used for menu availability broadcasts. Anyone
    // with a guest_id cookie may join (the same gate as join:order). The
    // only event this room receives today is menu:availability, which
    // carries no private data.
    socket.on("join:menu", (counterId: unknown) => {
      if (typeof counterId !== "string" || !counterId) return;
      if (!hasGuest && !staffSession) return;
      socket.join(ROOMS.menu(counterId));
    });
  });

  setIo(io);
  startPromoter();

  httpServer.listen(port, hostname, () => {
    console.log(`[smart-queue] ready on http://${hostname}:${port}`);
  });
}

main().catch((err) => {
  console.error("[smart-queue] fatal", err);
  process.exit(1);
});
