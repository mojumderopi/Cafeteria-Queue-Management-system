"use client";
import type { ReactNode } from "react";

export type OrderStatus =
  | "PENDING_CASHIER"
  | "APPROVED"
  | "REJECTED"
  | "PREPARING"
  | "READY"
  | "COMPLETED"
  | "CANCELLED";

export type PaymentStatus = "UNPAID" | "PAID" | "REFUNDED" | string;

const ORDER_LABEL: Record<OrderStatus, string> = {
  PENDING_CASHIER: "Awaiting cashier",
  APPROVED: "Approved",
  PREPARING: "Preparing",
  READY: "Ready for pickup",
  COMPLETED: "Collected",
  REJECTED: "Rejected",
  CANCELLED: "Cancelled",
};

const ORDER_CLASS: Record<OrderStatus, string> = {
  PENDING_CASHIER: "status-pending",
  APPROVED: "status-approved",
  PREPARING: "status-preparing",
  READY: "status-ready",
  COMPLETED: "status-completed",
  REJECTED: "status-rejected",
  CANCELLED: "status-cancelled",
};

export function StatusBadge({
  status,
  children,
  className = "",
}: {
  status: OrderStatus;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={`badge-status ${ORDER_CLASS[status] ?? "status-completed"} ${className}`}
      aria-label={`Status: ${ORDER_LABEL[status] ?? status}`}
    >
      {children ?? ORDER_LABEL[status] ?? status}
    </span>
  );
}

export function PaymentBadge({ status, className = "" }: { status: PaymentStatus; className?: string }) {
  if (status === "PAID") {
    return <span className={`chip chip-success ${className}`}>Paid</span>;
  }
  if (status === "REFUNDED") {
    return <span className={`chip chip-info ${className}`}>Refunded</span>;
  }
  return <span className={`chip chip-warning ${className}`}>Cash on pickup</span>;
}

export const ORDER_STATUS_LABEL = ORDER_LABEL;
