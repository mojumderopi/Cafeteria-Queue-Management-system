// Custom Next.js + Socket.IO server. Single port, single process.
// Run with: npm run dev (or `npm start` for production after `next build`).
import { createServer } from "node:http";
import next from "next";
import { Server as IOServer } from "socket.io";
import { setIo } from "./lib/bus";
import { startPromoter } from "./lib/promoter";
import { ROOMS } from "./lib/socket-events";

const dev = process.env.NODE_ENV !== "production";
const port = Number(process.env.PORT ?? 3000);
const hostname = process.env.HOSTNAME ?? "0.0.0.0";

async function main() {
  const app = next({ dev, hostname, port });
  const handle = app.getRequestHandler();
  await app.prepare();

  const httpServer = createServer((req, res) => handle(req, res));

  const io = new IOServer(httpServer, {
    path: "/api/socketio",
    cors: { origin: true, credentials: true },
  });

  // Minimal auth — any client can subscribe; staff rooms do additional server-side checks before emit.
  io.on("connection", (socket) => {
    socket.on("join:order", (orderId: string) => {
      if (typeof orderId === "string") socket.join(ROOMS.student(orderId));
    });
    socket.on("join:counter", (counterId: string) => {
      if (typeof counterId === "string") {
        socket.join(ROOMS.counter(counterId));
        socket.join(ROOMS.cashier(counterId));
        socket.join(ROOMS.kitchen(counterId));
      }
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