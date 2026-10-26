"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useSocket } from "@/hooks/useSocket";
import { EV, type OrderStatusEvent } from "@/lib/socket-events";
import { AppHeader } from "@/components/ui/AppHeader";
import { StatusBadge, type OrderStatus, PaymentBadge, ORDER_STATUS_LABEL } from "@/components/ui/StatusBadge";
import { Money } from "@/components/ui/Money";
import { Icon } from "@/components/ui/Icon";
import { ErrorPanel } from "@/components/ui/ErrorPanel";
import { EmptyState } from "@/components/ui/EmptyState";
import { ConnectionPill } from "@/components/ui/ConnectionPill";

interface OrderView {
  id: string;
  token: string;
  counterId: string;
  counterName: string;
  status: OrderStatus;
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

const STEPS: Array<{ key: OrderStatus; label: string; helper: string }> = [
  { key: "PENDING_CASHIER", label: "Sent to cashier", helper: "We received your order" },
  { key: "APPROVED", label: "Approved", helper: "Cashier accepted your order" },
  { key: "PREPARING", label: "In the kitchen", helper: "Cooking now" },
  { key: "READY", label: "Ready for pickup", helper: "Head to the counter" },
  { key: "COMPLETED", label: "Collected", helper: "Enjoy your meal" },
];

function formatClock(iso: string | null) {
  if (!iso) return null;
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function relTime(iso: string) {
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return "just now";
  const m = Math.floor(ms / 60_000);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

export default function OrderStatusPage({ params }: { params: { id: string } }) {
  const [order, setOrder] = useState<OrderView | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "missing" | "forbidden" | "error">("loading");
  const [tick, setTick] = useState(0); // re-render for "x ago" labels
  const sock = useSocket();
  const searchParams = useSearchParams();
  // The order tracking URL is /orders/<id>?t=<hmac-token>. The token is
  // issued at order-creation time and proves the requester has the
  // signed link. Without it, the API returns 403.
  const orderToken = searchParams.get("t");

  async function load(signal?: AbortSignal) {
    setState("loading");
    try {
      const qs = orderToken ? `?t=${encodeURIComponent(orderToken)}` : "";
      const r = await fetch(`/api/orders/${params.id}${qs}`, { signal });
      if (r.status === 404) {
        setState("missing");
        setOrder(null);
        return;
      }
      if (r.status === 403) {
        setState("forbidden");
        setOrder(null);
        return;
      }
      if (!r.ok) {
        setState("error");
        setOrder(null);
        return;
      }
      const j = await r.json();
      setOrder(j.order);
      setState("ready");
    } catch (e) {
      if ((e as { name?: string })?.name === "AbortError") return;
      setState("error");
    }
  }

  useEffect(() => {
    const ctl = new AbortController();
    load(ctl.signal);
    return () => ctl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.id]);

  useEffect(() => {
    if (!sock) return;
    // Send the tracking token along with the orderId. The server
    // requires either a valid token bound to this orderId OR a staff
    // session for the order's counter. Without a token, a guest can
    // still load the page (the API returns 403 -> "forbidden" state)
    // but cannot subscribe to realtime events.
    sock.emit("join:order", { orderId: params.id, token: orderToken ?? null });
    function onStatus(e: OrderStatusEvent) {
      if (e.orderId !== params.id) return;
      setOrder((o) =>
        o
          ? {
              ...o,
              status: e.status as OrderStatus,
              rejectReason: e.rejectReason ?? o.rejectReason,
              approvedAt:
                e.status === "APPROVED" && !o.approvedAt ? new Date().toISOString() : o.approvedAt,
              readyAt:
                e.status === "READY" && !o.readyAt ? new Date().toISOString() : o.readyAt,
              completedAt:
                e.status === "COMPLETED" && !o.completedAt
                  ? new Date().toISOString()
                  : o.completedAt,
            }
          : o
      );
    }
    sock.on(EV.orderStatus, onStatus);
    return () => {
      sock.off(EV.orderStatus, onStatus);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sock, params.id, orderToken]);

  useEffect(() => {
    const t = setInterval(() => setTick((x) => x + 1), 30_000);
    return () => clearInterval(t);
  }, []);

  if (state === "loading" && !order) {
    return (
      <div className="page-bg min-h-screen">
        <AppHeader title="Loading order…" backHref="/" backLabel="Home" />
        <div className="app-container py-6">
          <div className="card-lg p-6">
            <div className="skeleton mb-3 h-3 w-24" />
            <div className="skeleton mb-6 h-12 w-40" />
            <div className="space-y-3">
              {[1, 2, 3, 4, 5].map((i) => (
                <div key={i} className="flex items-center gap-3">
                  <div className="skeleton h-7 w-7 rounded-full" />
                  <div className="skeleton h-3 flex-1" />
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (state === "missing") {
    return (
      <div className="page-bg min-h-screen">
        <AppHeader title="Order" backHref="/" backLabel="Home" />
        <div className="app-container py-6">
          <EmptyState
            icon="Receipt"
            title="We can’t find this order"
            description="It may have been removed, or the link is incorrect."
            action={
              <Link href="/" className="btn btn-primary btn-sm">
                Back to home
              </Link>
            }
          />
        </div>
      </div>
    );
  }

  if (state === "forbidden") {
    return (
      <div className="page-bg min-h-screen">
        <AppHeader title="Order" backHref="/" backLabel="Home" />
        <div className="app-container py-6">
          <EmptyState
            icon="Alert"
            title="This link can’t open the order"
            description="The tracking link is missing or invalid. Open the link exactly as it was sent to you, or contact the counter."
            action={
              <Link href="/" className="btn btn-primary btn-sm">
                Back to home
              </Link>
            }
          />
        </div>
      </div>
    );
  }

  if (state === "error" && !order) {
    return (
      <div className="page-bg min-h-screen">
        <AppHeader title="Order" backHref="/" backLabel="Home" />
        <div className="app-container py-6">
          <ErrorPanel
            title="We couldn’t load your order"
            description="Check your connection and try again."
            onRetry={() => load()}
          />
        </div>
      </div>
    );
  }

  if (!order) return null;

  const cancelled = order.status === "CANCELLED" || order.status === "REJECTED";
  const currentIx = STEPS.findIndex((s) => s.key === order.status);

  return (
    <div className="page-bg min-h-screen pb-safe">
      <AppHeader
        title="Your order"
        subtitle={`${order.counterName} · #${order.token}`}
        backHref="/"
        backLabel="Home"
        right={<ConnectionPill />}
      />

      <div className="app-container max-w-2xl py-6">
        <div className="card-lg relative overflow-hidden p-6">
          <div
            className="absolute -right-12 -top-12 h-44 w-44 rounded-full"
            style={{ background: "var(--forest-100)", filter: "blur(50px)" }}
            aria-hidden
          />
          <div className="relative">
            <div className="flex items-center justify-between gap-2">
              <div className="section-title">Token</div>
              <StatusBadge status={order.status} />
            </div>
            <div
              className="token-display mt-1 text-ink-900"
              style={{ fontSize: "3.5rem", lineHeight: 1.05, color: "var(--forest-800)" }}
              aria-label={`Token ${order.token}`}
            >
              {order.token}
            </div>
            <p className="mt-1 text-sm text-ink-500">
              Show this code at the counter. Pay cash when you collect.
            </p>
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <PaymentBadge status={order.paymentStatus} />
              <span className="chip">
                <Icon.Clock size={12} aria-hidden /> Placed {relTime(order.createdAt)} · {formatClock(order.createdAt)}
              </span>
            </div>
          </div>
        </div>

        {cancelled ? (
          <div
            className="card-lg mt-4 p-5"
            role="alert"
            style={{ borderColor: "var(--danger-100)" }}
          >
            <div className="flex items-start gap-3">
              <div
                className="grid h-9 w-9 place-items-center rounded-full"
                style={{ background: "var(--danger-100)", color: "var(--danger-600)" }}
                aria-hidden
              >
                <Icon.Alert size={18} aria-hidden />
              </div>
              <div>
                <div className="text-sm font-semibold text-ink-900">
                  {order.status === "REJECTED" ? "This order was rejected" : "This order was cancelled"}
                </div>
                {order.rejectReason ? (
                  <div className="mt-1 text-sm text-ink-500">{order.rejectReason}</div>
                ) : (
                  <div className="mt-1 text-sm text-ink-500">
                    Please speak to the counter staff or place a new order.
                  </div>
                )}
              </div>
            </div>
          </div>
        ) : (
          <section className="card-lg mt-4 p-5" aria-label="Order progress">
            <ol className="space-y-3">
              {STEPS.map((s, i) => {
                const done = i < currentIx;
                const active = i === currentIx;
                const reachedAt =
                  s.key === "PENDING_CASHIER"
                    ? order.createdAt
                    : s.key === "APPROVED"
                    ? order.approvedAt
                    : s.key === "READY"
                    ? order.readyAt
                    : s.key === "COMPLETED"
                    ? order.completedAt
                    : null;
                return (
                  <li key={s.key} className="flex items-start gap-3">
                    <div
                      className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-xs font-bold"
                      style={{
                        background: done
                          ? "var(--forest-700)"
                          : active
                          ? "var(--amber-500)"
                          : "var(--cream-200)",
                        color: done || active ? "white" : "var(--ink-500)",
                        boxShadow: active ? "0 0 0 4px rgba(245,158,11,0.18)" : undefined,
                      }}
                      aria-current={active ? "step" : undefined}
                    >
                      {done ? <Icon.Check size={14} aria-hidden /> : i + 1}
                    </div>
                    <div className="flex-1">
                      <div
                        className={
                          active
                            ? "text-sm font-semibold text-ink-900"
                            : done
                            ? "text-sm font-medium text-ink-700"
                            : "text-sm text-ink-500"
                        }
                      >
                        {s.label}
                      </div>
                      <div className="text-xs text-ink-500">
                        {done && reachedAt
                          ? `${s.helper} · ${formatClock(reachedAt)}`
                          : active
                          ? s.helper
                          : s.helper}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ol>
            {order.status === "PENDING_CASHIER" ? (
              <div
                className="mt-4 flex items-center gap-2 rounded-lg p-2 text-xs"
                style={{ background: "var(--cream-200)", color: "var(--ink-700)" }}
                data-tick={tick}
              >
                <span className="spinner" aria-hidden />
                Waiting for cashier approval…
              </div>
            ) : null}
            {order.status === "PREPARING" ? (
              <div
                className="mt-4 flex items-center gap-2 rounded-lg p-2 text-xs"
                style={{ background: "var(--info-100)", color: "var(--info-600)" }}
                role="status"
              >
                <Icon.Flame size={14} aria-hidden /> Being prepared. We&apos;ll alert you when it&apos;s ready.
              </div>
            ) : null}
            {order.status === "READY" ? (
              <div
                className="mt-4 flex items-center gap-2 rounded-lg p-2 text-sm font-semibold"
                style={{ background: "var(--success-100)", color: "var(--success-600)" }}
                role="alert"
              >
                <Icon.Bell size={14} aria-hidden /> Your order is ready — please collect at the counter.
              </div>
            ) : null}
          </section>
        )}

        <section className="card-lg mt-4 p-5" aria-label="Order items">
          <div className="flex items-center justify-between">
            <div className="section-title">Items</div>
            <div className="text-xs text-ink-500">{order.items.reduce((s, i) => s + i.qty, 0)} pcs</div>
          </div>
          <ul className="mt-2 divide-y" style={{ borderColor: "var(--border-soft)" }}>
            {order.items.map((it) => (
              <li key={it.menuItemId} className="flex items-center justify-between py-2 text-sm">
                <span className="text-ink-900">
                  {it.name} <span className="text-ink-500">× {it.qty}</span>
                </span>
                <span className="text-ink-700 text-mono-num">
                  <Money minor={it.unitPrice * it.qty} />
                </span>
              </li>
            ))}
          </ul>
          <div className="mt-2 flex items-center justify-between border-t pt-2 text-sm font-semibold" style={{ borderColor: "var(--border-soft)" }}>
            <span className="text-ink-700">Total</span>
            <span className="text-ink-900 text-mono-num">
              <Money minor={order.totalCents} />
            </span>
          </div>
        </section>

        <div className="mt-6 flex items-center justify-between gap-2 text-xs text-ink-500">
          <Link href="/" className="btn btn-ghost btn-sm">
            <Icon.ChevronLeft size={14} aria-hidden /> Back to home
          </Link>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => load()}
            aria-label="Refresh order"
          >
            <Icon.Refresh size={14} aria-hidden /> Refresh
          </button>
        </div>
      </div>
    </div>
  );
}
