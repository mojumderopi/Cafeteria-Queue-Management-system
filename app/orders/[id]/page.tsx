"use client";

import { useEffect, useState } from "react";
import { useSocket } from "@/hooks/useSocket";
import { EV, type OrderStatusEvent } from "@/lib/socket-events";

interface OrderView {
  id: string;
  token: string;
  counterId: string;
  counterName: string;
  status: string;
  paymentStatus: string;
  totalCents: number;
  priorityScore: number;
  rejectReason?: string | null;
  createdAt: string;
  approvedAt: string | null;
  readyAt: string | null;
  completedAt: string | null;
  items: { menuItemId: string; name: string; qty: number; unitPrice: number }[];
}

const STEPS = [
  { key: "PENDING_CASHIER", label: "Awaiting cashier" },
  { key: "APPROVED", label: "Approved" },
  { key: "PREPARING", label: "Preparing" },
  { key: "READY", label: "Ready for pickup" },
  { key: "COMPLETED", label: "Collected" },
];

export default function OrderStatusPage({ params }: { params: { id: string } }) {
  const [order, setOrder] = useState<OrderView | null>(null);
  const [hop, setHop] = useState(0); // forces re-render of "waiting for Xm" each minute
  const sock = useSocket();

  useEffect(() => {
    fetch(`/api/orders/${params.id}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((j) => setOrder(j.order))
      .catch(() => setOrder(null));
  }, [params.id]);

  useEffect(() => {
    if (!sock) return;
    sock.emit("join:order", params.id);
    function onStatus(e: OrderStatusEvent) {
      if (e.orderId !== params.id) return;
      setOrder((o) => (o ? { ...o, status: e.status, rejectReason: e.rejectReason ?? o.rejectReason } : o));
    }
    sock.on(EV.orderStatus, onStatus);
    return () => {
      sock.off(EV.orderStatus, onStatus);
    };
  }, [sock, params.id]);

  useEffect(() => {
    const t = setInterval(() => setHop((h) => h + 1), 30_000);
    return () => clearInterval(t);
  }, []);

  if (!order) return <div className="card mt-10 animate-pulse h-40" />;

  const currentIx = STEPS.findIndex((s) => s.key === order.status);
  const cancelled = order.status === "CANCELLED" || order.status === "REJECTED";

  return (
    <main className="mx-auto max-w-xl px-4 py-6">
      <div className="rounded-3xl bg-white p-6 shadow ring-1 ring-stone-200">
        <div className="flex items-center justify-between">
          <div className="text-sm text-stone-500">Your token</div>
          <div className="chip">{order.counterName}</div>
        </div>
        <div className="mt-1 text-5xl font-black tracking-tight text-brand-600">{order.token}</div>
        <div className="mt-1 text-sm text-stone-600">Show this at the counter. Pay cash on pickup.</div>

        {cancelled ? (
          <div className="mt-6 rounded-xl bg-red-50 p-4 text-red-800">
            <div className="font-semibold">{order.status === "REJECTED" ? "Order rejected" : "Order cancelled"}</div>
            {order.rejectReason && <div className="text-sm">{order.rejectReason}</div>}
          </div>
        ) : (
          <ol className="mt-6 space-y-3">
            {STEPS.map((s, i) => {
              const done = i < currentIx;
              const active = i === currentIx;
              return (
                <li key={s.key} className="flex items-center gap-3">
                  <div className={`h-7 w-7 rounded-full flex items-center justify-center text-xs font-bold ${
                    done ? "bg-emerald-500 text-white" : active ? "bg-brand-500 text-white animate-pulse" : "bg-stone-200 text-stone-600"
                  }`}>{i + 1}</div>
                  <div className={`flex-1 ${active ? "font-semibold" : ""}`}>{s.label}</div>
                </li>
              );
            })}
          </ol>
        )}

        <div className="mt-6 border-t border-stone-200 pt-4 text-sm">
          <div className="text-stone-500">Items</div>
          <ul className="mt-1 space-y-0.5">
            {order.items.map((it) => (
              <li key={it.menuItemId} className="flex justify-between">
                <span>{it.name} × {it.qty}</span>
                <span>৳{((it.unitPrice * it.qty) / 100).toFixed(2)}</span>
              </li>
            ))}
          </ul>
          <div className="mt-2 flex justify-between font-semibold">
            <span>Total</span>
            <span>৳{(order.totalCents / 100).toFixed(2)}</span>
          </div>
        </div>

        {order.status === "PENDING_CASHIER" && (
          <div className="mt-4 text-xs text-stone-500" data-hop={hop}>Waiting for cashier approval…</div>
        )}
      </div>
    </main>
  );
}