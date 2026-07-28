"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useSocket } from "@/hooks/useSocket";
import { EV, type OrderNewEvent, type OrderStatusEvent, type StockLowEvent } from "@/lib/socket-events";
import { useToast } from "@/components/Toast";

interface OrderRow {
  id: string;
  token: string;
  counterId: string;
  status: string;
  paymentStatus: string;
  totalCents: number;
  priorityScore: number;
  createdAt: string;
  items: { menuItemId: string; name: string; qty: number; unitPrice: number }[];
}
interface CounterRow { id: string; slug: string; name: string }

const STATUS_GROUPS = [
  { key: "PENDING_CASHIER", label: "Pending" },
  { key: "APPROVED", label: "Approved (in kitchen)" },
  { key: "PREPARING", label: "Preparing" },
  { key: "READY", label: "Ready — awaiting pickup" },
];

export default function CashierDashboard() {
  const [counters, setCounters] = useState<CounterRow[]>([]);
  const [counterId, setCounterId] = useState<string | null>(null);
  const [tab, setTab] = useState<"PENDING_CASHIER" | "APPROVED" | "PREPARING" | "READY">("PENDING_CASHIER");
  const [orders, setOrders] = useState<OrderRow[]>([]);
  // Token the cashier is currently typing, keyed by order id so each row only
  // re-renders itself, not the whole list, on every keystroke.
  const [collectToken, setCollectToken] = useState<Record<string, string>>({});
  const toast = useToast();
  const sock = useSocket();

  useEffect(() => {
    fetch("/api/staff/counters")
      .then((r) => r.json())
      .then((j) => {
        setCounters(j.counters ?? []);
        if (j.counters?.[0]) setCounterId(j.counters[0].id);
      });
  }, []);

  useEffect(() => {
    if (!counterId) return;
    load();
    if (sock) sock.emit("join:counter", counterId);
  }, [counterId, sock]);

  async function load() {
    if (!counterId) return;
    const res = await fetch(`/api/staff/orders?counterId=${counterId}&status=${tab}`);
    const j = await res.json();
    setOrders(j.orders ?? []);
  }

  useEffect(() => {
    if (!sock || !counterId) return;
    function onNew(e: OrderNewEvent) {
      if (e.counterId !== counterId) return;
      if (tab === "PENDING_CASHIER") load();
      toast.push(`New order ${e.token}`, "info");
    }
    function onStatus(e: OrderStatusEvent) {
      if (e.counterId !== counterId) return;
      load();
    }
    function onStock(e: StockLowEvent) {
      if (e.counterId !== counterId) return;
      toast.push(`Low stock: ${e.remaining} left`, "error");
    }
    sock.on(EV.orderNew, onNew);
    sock.on(EV.orderStatus, onStatus);
    sock.on(EV.stockLow, onStock);
    return () => {
      sock.off(EV.orderNew, onNew);
      sock.off(EV.orderStatus, onStatus);
      sock.off(EV.stockLow, onStock);
    };
  }, [sock, counterId, tab]);

  async function act(orderId: string, kind: "approve" | "reject" | "collect") {
    const url =
      kind === "approve"
        ? `/api/cashier/orders/${orderId}/approve`
        : kind === "reject"
        ? `/api/cashier/orders/${orderId}/reject`
        : `/api/cashier/orders/${orderId}/collect`;
    const body =
      kind === "reject"
        ? JSON.stringify({ reason: "Out of stock" })
        : kind === "collect"
        ? JSON.stringify({ token: collectToken[orderId] ?? "" })
        : undefined;
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      toast.push(j.error ?? "Action failed", "error");
    } else {
      toast.push(kind === "collect" ? "Payment collected ✓" : `Order ${kind}d`, "success");
      if (kind === "collect") {
        setCollectToken((m) => {
          const next = { ...m };
          delete next[orderId];
          return next;
        });
      }
      load();
    }
  }

  return (
    <main className="mx-auto max-w-5xl px-4 py-6">
      <div className="flex items-center justify-between">
        <div>
          <Link href="/" className="text-xs text-stone-500 hover:underline">← Home</Link>
          <h1 className="text-2xl font-bold">Cashier</h1>
        </div>
        <div className="flex gap-2">
          <select
            value={counterId ?? ""}
            onChange={(e) => setCounterId(e.target.value)}
            className="rounded-xl border border-stone-300 px-3 py-2 text-sm"
          >
            {counters.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
          <button
            className="btn-ghost text-sm"
            onClick={async () => {
              await fetch("/api/auth/login", { method: "DELETE" });
              location.href = "/login";
            }}
          >
            Sign out
          </button>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {STATUS_GROUPS.map((g) => (
          <button
            key={g.key}
            onClick={() => setTab(g.key as any)}
            className={`rounded-full px-3 py-1.5 text-sm ${tab === g.key ? "bg-brand-500 text-white" : "bg-stone-100 text-stone-700"}`}
          >
            {g.label}
          </button>
        ))}
      </div>

      <ul className="mt-4 space-y-3">
        {orders.length === 0 && <li className="card text-center text-stone-500">Nothing here.</li>}
        {orders.map((o) => (
          <li key={o.id} className="card">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <div className="text-2xl font-black text-brand-600">{o.token}</div>
                  <span className="chip">{o.status}</span>
                  <span className={`chip ${o.paymentStatus === "PAID" ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"}`}>
                    {o.paymentStatus === "PAID" ? "Paid" : "Cash on pickup"}
                  </span>
                </div>
                <ul className="mt-2 text-sm text-stone-700">
                  {o.items.map((it) => (
                    <li key={it.menuItemId}>{it.name} × {it.qty}</li>
                  ))}
                </ul>
                <div className="mt-2 text-sm font-semibold">৳{(o.totalCents / 100).toFixed(2)}</div>
              </div>
              <div className="flex flex-col gap-2">
                {tab === "PENDING_CASHIER" && (
                  <>
                    <button className="btn-primary" onClick={() => act(o.id, "approve")}>Approve</button>
                    <button className="btn-danger" onClick={() => act(o.id, "reject")}>Reject</button>
                  </>
                )}
                {tab === "READY" && (
                  <>
                    <input
                      className="rounded-xl border border-stone-300 px-3 py-2 text-sm uppercase"
                      placeholder="Token"
                      value={collectToken[o.id] ?? ""}
                      onChange={(e) =>
                        setCollectToken((m) => ({ ...m, [o.id]: e.target.value }))
                      }
                    />
                    <button
                      className="btn-primary"
                      disabled={!collectToken[o.id]}
                      onClick={() => act(o.id, "collect")}
                    >
                      Confirm cash & complete
                    </button>
                  </>
                )}
              </div>
            </div>
          </li>
        ))}
      </ul>
    </main>
  );
}