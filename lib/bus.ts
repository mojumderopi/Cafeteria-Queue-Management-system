// Server-side socket emitter singleton used by API routes.
// server.ts attaches the actual io instance via setIo() on boot.
import type { Server as IOServer } from "socket.io";
import { EV, ROOMS, type OrderNewEvent, type OrderStatusEvent, type StockLowEvent } from "./socket-events";

let io: IOServer | null = null;

export function setIo(server: IOServer) {
  io = server;
}

export function getIo(): IOServer | null {
  return io;
}

export function emitOrderNew(e: OrderNewEvent) {
  if (!io) return;
  io.to(ROOMS.cashier(e.counterId)).to(ROOMS.counter(e.counterId)).emit(EV.orderNew, e);
}

export function emitOrderStatus(e: OrderStatusEvent) {
  if (!io) return;
  io.to(ROOMS.student(e.orderId))
    .to(ROOMS.cashier(e.counterId))
    .to(ROOMS.kitchen(e.counterId))
    .to(ROOMS.counter(e.counterId))
    .emit(EV.orderStatus, e);
}

export function emitStockLow(e: StockLowEvent) {
  if (!io) return;
  io.to(ROOMS.counter(e.counterId)).to(ROOMS.cashier(e.counterId)).emit(EV.stockLow, e);
}