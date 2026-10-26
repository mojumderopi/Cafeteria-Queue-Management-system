"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useSocket } from "@/hooks/useSocket";
import { EV, type OrderNewEvent, type OrderStatusEvent, type StockLowEvent } from "@/lib/socket-events";
import { useToast } from "@/components/Toast";
import { StatusBadge, type OrderStatus, PaymentBadge } from "@/components/ui/StatusBadge";
import { Money } from "@/components/ui/Money";
import { Icon } from "@/components/ui/Icon";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorPanel } from "@/components/ui/ErrorPanel";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { AppHeader } from "@/components/ui/AppHeader";
import { ConnectionPill } from "@/components/ui/ConnectionPill";
import { CashierAvailability } from "@/components/CashierAvailability";

interface OrderRow {
  id: string;
  token: string;
  counterId: string;
  status: OrderStatus;
  paymentStatus: string;
  totalCents: number;
  priorityScore: number;
  createdAt: string;
  approvedAt: string | null;
  readyAt: string | null;
  items: { menuItemId: string; name: string; qty: number; unitPrice: number }[];
}
interface CounterRow { id: string; slug: string; name: string }

const STATUS_GROUPS: Array<{ key: OrderStatus; label: string }> = [
  { key: "PENDING_CASHIER", label: "Pending" },
  { key: "APPROVED", label: "In kitchen" },
  { key: "PREPARING", label: "Preparing" },
  { key: "READY", label: "Ready" },
];

export default function CashierDashboard() {
  const [counters, setCounters] = useState<CounterRow[]>([]);
  const [counterId, setCounterId] = useState<string | null>(null);
  const [tab, setTab] = useState<OrderStatus>("PENDING_CASHIER");
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [loadState, setLoadState] = useState<"loading" | "ready" | "error">("loading");
  const [collectToken, setCollectToken] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<OrderRow | null>(null);
  const [rejectReason, setRejectReason] = useState("Out of stock");
  const [rejectLoading, setRejectLoading] = useState(false);
  const [collecting, setCollecting] = useState<OrderRow | null>(null);
  const [collectLoading, setCollectLoading] = useState(false);
  const [role, setRole] = useState<"CASHIER" | "KITCHEN" | "ADMIN" | null>(null);
  const toast = useToast();
  const sock = useSocket();

  useEffect(() => {
    let alive = true;
    fetch("/api/staff/counters")
      .then(async (r) => {
        if (!r.ok) throw new Error("counters_failed");
        return r.json();
      })
      .then((j) => {
        if (!alive) return;
        setCounters(j.counters ?? []);
        if (j.counters?.[0]) setCounterId(j.counters[0].id);
      })
      .catch(() => {
        toast.push("Could not load counters", "error");
      });
    // Load the current session for role-aware navigation.
    fetch("/api/staff/me")
      .then(async (r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (alive && j) setRole(j.role);
      })
      .catch(() => {
        /* ignore */
      });
    return () => {
      alive = false;
    };
  }, [toast]);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      if (!counterId) return;
      setLoadState("loading");
      try {
        const res = await fetch(
          `/api/staff/orders?counterId=${counterId}&status=${tab}`,
          { signal }
        );
        if (!res.ok) throw new Error("orders_failed");
        const j = await res.json();
        setOrders(j.orders ?? []);
        setLoadState("ready");
      } catch (e) {
        if ((e as { name?: string })?.name === "AbortError") return;
        setLoadState("error");
      }
    },
    [counterId, tab]
  );

  useEffect(() => {
    if (!counterId) return;
    const ctl = new AbortController();
    load(ctl.signal);
    if (sock) sock.emit("join:counter", counterId);
    return () => ctl.abort();
  }, [counterId, sock, load]);

  // Realtime fallback: re-fetch every 60s even when the socket is
  // connected, so a missed event doesn't leave the cashier looking at a
  // stale list. Idempotent.
  useEffect(() => {
    if (!counterId) return;
    const t = setInterval(() => load(), 60_000);
    return () => clearInterval(t);
  }, [counterId, load]);

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
  }, [sock, counterId, tab, load, toast]);

  async function approve(id: string) {
    setBusyId(id);
    try {
      const res = await fetch(`/api/cashier/orders/${id}/approve`, { method: "POST" });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        if (j.error === "bad_state") toast.push("This order was already handled by another staff member", "info");
        else toast.push(j.error ?? "Could not approve", "error");
      } else {
        toast.push("Order approved", "success");
        load();
      }
    } catch {
      toast.push("Network error", "error");
    } finally {
      setBusyId(null);
    }
  }

  async function confirmReject() {
    if (!rejecting) return;
    setRejectLoading(true);
    try {
      const res = await fetch(`/api/cashier/orders/${rejecting.id}/reject`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reason: rejectReason }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        toast.push(j.error ?? "Could not reject", "error");
      } else {
        toast.push("Order rejected", "info");
        setRejecting(null);
        load();
      }
    } catch {
      toast.push("Network error", "error");
    } finally {
      setRejectLoading(false);
    }
  }

  async function confirmCollect() {
    if (!collecting) return;
    const token = (collectToken[collecting.id] ?? "").trim();
    if (!token) {
      toast.push("Please enter the customer's token", "error");
      return;
    }
    setCollectLoading(true);
    try {
      const res = await fetch(`/api/cashier/orders/${collecting.id}/collect`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        if (j.error === "token_mismatch") toast.push("That token doesn't match this order", "error");
        else if (j.error === "bad_state") toast.push("This order was already collected", "info");
        else toast.push(j.error ?? "Could not complete", "error");
        return;
      }
      toast.push("Payment collected", "success");
      setCollecting(null);
      setCollectToken((m) => {
        const next = { ...m };
        delete next[collecting.id];
        return next;
      });
      load();
    } catch {
      toast.push("Network error", "error");
    } finally {
      setCollectLoading(false);
    }
  }

  async function signOut() {
    try {
      await fetch("/api/auth/login", { method: "DELETE" });
    } catch {
      /* ignore */
    } finally {
      location.href = "/login";
    }
  }

  return (
    <div className="page-bg min-h-screen">
      <AppHeader
        title="Cashier console"
        subtitle={
          counters.find((c) => c.id === counterId)?.name ?? "Loading counters…"
        }
        backHref="/"
        backLabel="Home"
        right={
          <>
            <ConnectionPill className="hidden sm:inline-flex" />
            {role === "ADMIN" ? (
              <>
                <Link
                  href="/admin"
                  className="btn btn-ghost btn-sm"
                  aria-label="Open admin dashboard"
                >
                  <Icon.Chart size={14} aria-hidden /> Admin
                </Link>
                <Link
                  href="/admin/menu"
                  className="btn btn-ghost btn-sm"
                  aria-label="Open full menu management"
                >
                  <Icon.Edit size={14} aria-hidden /> Menu
                </Link>
              </>
            ) : null}
            {counterId ? (
              <select
                aria-label="Select counter"
                value={counterId}
                onChange={(e) => setCounterId(e.target.value)}
                className="select hidden sm:block"
                style={{ minWidth: 180 }}
              >
                {counters.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            ) : null}
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={signOut}
            >
              <Icon.Logout size={14} aria-hidden /> Sign out
            </button>
          </>
        }
      />

      <div className="app-container py-4">
        {counterId ? (
          <div className="mb-3 sm:hidden">
            <label className="field-label" htmlFor="counter-mobile">Counter</label>
            <select
              id="counter-mobile"
              className="select"
              value={counterId}
              onChange={(e) => setCounterId(e.target.value)}
            >
              {counters.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
        ) : null}

        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-full p-1" style={{ background: "var(--cream-200)" }} role="tablist" aria-label="Order status">
            {STATUS_GROUPS.map((g) => {
              const active = tab === g.key;
              return (
                <button
                  key={g.key}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setTab(g.key)}
                  className="rounded-full px-3.5 py-1.5 text-sm font-semibold transition"
                  style={
                    active
                      ? { background: "var(--forest-700)", color: "white", boxShadow: "var(--shadow-xs)" }
                      : { color: "var(--ink-700)" }
                  }
                >
                  {g.label}
                </button>
              );
            })}
          </div>
          <button
            type="button"
            onClick={() => load()}
            className="btn btn-ghost btn-sm"
            aria-label="Refresh"
            title="Refresh"
          >
            <Icon.Refresh size={14} aria-hidden /> Refresh
          </button>
        </div>

        <section className="mt-4">
          {loadState === "loading" && orders.length === 0 ? (
            <div className="space-y-3" aria-busy="true">
              {[1, 2, 3].map((i) => (
                <div key={i} className="card flex gap-3 p-4">
                  <div className="skeleton h-12 w-20" />
                  <div className="flex-1 space-y-2">
                    <div className="skeleton h-3 w-1/3" />
                    <div className="skeleton h-3 w-2/3" />
                    <div className="skeleton h-3 w-1/2" />
                  </div>
                  <div className="skeleton h-9 w-24" />
                </div>
              ))}
            </div>
          ) : loadState === "error" ? (
            <ErrorPanel
              title="Couldn’t load orders"
              description="Please check your connection and try again."
              onRetry={() => load()}
            />
          ) : orders.length === 0 ? (
            <EmptyState
              icon="Receipt"
              title="Nothing here right now"
              description={
                tab === "PENDING_CASHIER"
                  ? "New orders will appear here as students place them."
                  : tab === "READY"
                  ? "No orders waiting for pickup."
                  : "All clear."
              }
            />
          ) : (
            <ul className="space-y-3" aria-label="Orders">
              {orders.map((o) => {
                const items = o.items;
                const isPending = tab === "PENDING_CASHIER";
                const isReady = tab === "READY";
                const isCollecting = collecting?.id === o.id;
                const collected = busyId === o.id;
                return (
                  <li key={o.id} className="card flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
                    <div
                      className="token-display flex shrink-0 flex-col items-center justify-center rounded-xl px-4 py-2 text-center"
                      style={{ background: "var(--cream-200)", color: "var(--forest-800)", minWidth: 100 }}
                    >
                      <div className="text-[10px] font-semibold uppercase tracking-wider text-ink-500">Token</div>
                      <div className="text-2xl">{o.token}</div>
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <StatusBadge status={o.status} />
                        <PaymentBadge status={o.paymentStatus} />
                        <span className="chip">
                          <Icon.Clock size={12} aria-hidden /> {new Date(o.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                        </span>
                      </div>
                      <ul className="mt-2 text-sm text-ink-700">
                        {items.map((it) => (
                          <li key={it.menuItemId} className="flex items-center justify-between gap-2">
                            <span>
                              <span className="text-ink-900">{it.name}</span>
                              <span className="text-ink-500"> × {it.qty}</span>
                            </span>
                            <span className="text-xs text-ink-500 text-mono-num">
                              <Money minor={it.unitPrice * it.qty} />
                            </span>
                          </li>
                        ))}
                      </ul>
                      <div className="mt-1 text-sm font-semibold text-ink-900">
                        Total <span className="text-mono-num"><Money minor={o.totalCents} /></span>
                      </div>
                    </div>

                    <div className="flex shrink-0 flex-col gap-2 sm:w-56">
                      {isPending && (
                        <>
                          <button
                            type="button"
                            className="btn btn-primary"
                            onClick={() => approve(o.id)}
                            disabled={collected}
                            aria-busy={collected || undefined}
                          >
                            {collected ? <span className="spinner" aria-hidden /> : <Icon.Check size={16} aria-hidden />}
                            Approve
                          </button>
                          <button
                            type="button"
                            className="btn btn-soft"
                            onClick={() => {
                              setRejecting(o);
                              setRejectReason("Out of stock");
                            }}
                            disabled={collected}
                          >
                            <Icon.X size={16} aria-hidden /> Reject
                          </button>
                        </>
                      )}
                      {isReady && (
                        <>
                          <label className="field-label" htmlFor={`token-${o.id}`}>
                            Customer token
                          </label>
                          <input
                            id={`token-${o.id}`}
                            className="input text-mono-num"
                            inputMode="text"
                            autoCapitalize="characters"
                            placeholder="e.g. A27"
                            value={collectToken[o.id] ?? ""}
                            onChange={(e) =>
                              setCollectToken((m) => ({ ...m, [o.id]: e.target.value.toUpperCase() }))
                            }
                            aria-label={`Token for order ${o.token}`}
                            disabled={isCollecting}
                          />
                          <button
                            type="button"
                            className="btn btn-primary"
                            onClick={() => setCollecting(o)}
                            disabled={!(collectToken[o.id] ?? "").trim() || isCollecting}
                          >
                            <Icon.Cash size={16} aria-hidden /> Confirm cash & complete
                          </button>
                        </>
                      )}
                      {!isPending && !isReady && (
                        <div className="text-xs text-ink-500">
                          {o.status === "APPROVED"
                            ? "Sent to kitchen"
                            : o.status === "PREPARING"
                            ? "Being prepared"
                            : "—"}
                        </div>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <CashierAvailability counterId={counterId} isAdmin={role === "ADMIN"} />
      </div>

      <ConfirmDialog
        open={!!rejecting}
        title="Reject this order?"
        description="The customer will be notified immediately. Use this only when items are no longer available."
        destructive
        confirmLabel="Reject order"
        cancelLabel="Keep order"
        loading={rejectLoading}
        onCancel={() => !rejectLoading && setRejecting(null)}
        onConfirm={confirmReject}
      >
        <div className="field">
          <label className="field-label" htmlFor="reject-reason">Reason</label>
          <input
            id="reject-reason"
            className="input"
            value={rejectReason}
            maxLength={120}
            onChange={(e) => setRejectReason(e.target.value)}
            disabled={rejectLoading}
          />
        </div>
      </ConfirmDialog>

      <ConfirmDialog
        open={!!collecting}
        title="Mark as paid and complete?"
        description={
          collecting
            ? `Confirm cash received for order ${collecting.token} (${new Intl.NumberFormat("en-BD", { style: "currency", currency: "BDT" }).format(collecting.totalCents / 100)}).`
            : ""
        }
        confirmLabel="Yes, complete"
        cancelLabel="Cancel"
        loading={collectLoading}
        onCancel={() => !collectLoading && setCollecting(null)}
        onConfirm={confirmCollect}
      />
    </div>
  );
}
