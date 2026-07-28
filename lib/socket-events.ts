// Single source of truth for Socket.IO event names + payload shapes.
export const EV = {
  orderNew: "order:new",
  orderStatus: "order:status",
  stockLow: "stock:low",
  queuePromoted: "queue:promoted",
} as const;

export type OrderStatusValue =
  | "PENDING_CASHIER"
  | "APPROVED"
  | "REJECTED"
  | "PREPARING"
  | "READY"
  | "COMPLETED"
  | "CANCELLED";

export interface OrderStatusEvent {
  orderId: string;
  token: string;
  counterId: string;
  status: OrderStatusValue;
  priorityScore?: number;
  rejectReason?: string;
}

export interface OrderNewEvent {
  orderId: string;
  token: string;
  counterId: string;
  totalCents: number;
  priorityScore: number;
}

export interface StockLowEvent {
  counterId: string;
  menuItemId: string;
  remaining: number;
}

export const ROOMS = {
  student: (orderId: string) => `student:${orderId}`,
  cashier: (counterId: string) => `cashier:${counterId}`,
  kitchen: (counterId: string) => `kitchen:${counterId}`,
  counter: (counterId: string) => `counter:${counterId}`,
};