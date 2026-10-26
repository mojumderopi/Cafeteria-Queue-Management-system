// Single source of truth for Socket.IO event names + payload shapes.
export const EV = {
  orderNew: "order:new",
  orderStatus: "order:status",
  stockLow: "stock:low",
  queuePromoted: "queue:promoted",
  menuAvailability: "menu:availability",
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

// Public menu availability update. The cashier UI maintains the manual
// availability flag; the public order API additionally requires stock > 0.
// We send both so the student menu can re-derive the combined state and the
// cashier panel can show three distinct states (available / out of stock /
// manually disabled).
export interface MenuAvailabilityEvent {
  counterId: string;
  itemId: string;
  isAvailable: boolean;   // manual flag (cashier intent)
  stockRemaining: number; // authoritative Redis count
  archived: boolean;      // true when the item is soft-deleted
  updatedAt: string;      // ISO timestamp
}

export const ROOMS = {
  student: (orderId: string) => `student:${orderId}`,
  cashier: (counterId: string) => `cashier:${counterId}`,
  kitchen: (counterId: string) => `kitchen:${counterId}`,
  counter: (counterId: string) => `counter:${counterId}`,
  // Public menu room. Anyone (student, kitchen, cashier, admin) may join
  // this room for a counter. The only event broadcast here today is
  // menu:availability, which carries no private data.
  menu: (counterId: string) => `menu:${counterId}`,
};
