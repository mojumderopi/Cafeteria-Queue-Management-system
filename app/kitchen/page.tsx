"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useSocket } from "@/hooks/useSocket";
import { EV, type OrderNewEvent, type OrderStatusEvent } from "@/lib/socket-events";
import { useToast } from "@/components/Toast";
import { AppHeader } from "@/components/ui/AppHeader";
import { ConnectionPill } from "@/components/ui/ConnectionPill";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorPanel } from "@/components/ui/ErrorPanel";
import { Icon } from "@/components/ui/Icon";

interface OrderRow {
  id: string;
  token: string;
  counterId: string;
  status: "PENDING_CASHIER" | "APPROVED" | "PREPARING" | "READY" | "REJECTED" | "COMPLETED" | "CANCELLED";
  totalCents: number;
  priorityScore: number;
  createdAt: string;
  approvedAt: string | null;
  readyAt: string | null;
  items: { menuItemId: string; name: string; qty: number; unitPrice: number }[];
}
interface CounterRow { id: string; slug: string; name: string }

type Column = "APPROVED" | "PREPARING" | "READY";

const COLUMNS: Array<{ key: Column; title: string; description: string; tone: string }> = [
  { key: "APPROVED",  title: "Incoming",   description: "Newly approved by cashier",     tone: "var(--info-600)" },
  { key: "PREPARING", title: "Preparing",  description: "On the stove or in the fryer",  tone: "var(--amber-600)" },
  { key: "READY",     title: "Ready",      description: "Ready for pickup",              tone: "var(--success-600)" },
];

function relMinutes(iso: string) {
  return Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60000));
}
function relText(min: number) {
  if (min < 1) return "just now";
  if (min < 60) return `${min}m wait`;
  return `${Math.floor(min / 60)}h ${min % 60}m wait`;
}

export default function KitchenBoard() {
  const [counters, setCounters] = useState<CounterRow[]>([]);
  const [counterId, setCounterId] = useState<string | null>(null);
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [loadState, setLoadState] = useState<"loading" | "ready" | "error">("loading");
  const [, setTick] = useState(0);
  const [busyId, setBusyId] = useState<string | null>(null);
  const toast = useToast();
  const sock = useSocket();
  const audioCtx = useRef<AudioContext | null>(null);
  const orderEls = useRef<Record<string, HTMLLIElement | null>>({});

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
          `/api/staff/orders?counterId=${counterId}&status=APPROVED,PREPARING,READY`,
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
    [counterId]
  );

  useEffect(() => {
    if (!counterId) return;
    const ctl = new AbortController();
    load(ctl.signal);
    if (sock) sock.emit("join:counter", counterId);
    return () => ctl.abort();
  }, [counterId, sock, load]);

  // Tick every 30s to refresh relative timestamps.
  useEffect(() => {
    const t = setInterval(() => setTick((x) => x + 1), 30_000);
    return () => clearInterval(t);
  }, []);

  // Realtime fallback: even when the socket is connected we re-fetch the
  // queue every 60s as a safety net. This keeps the kitchen's view
  // consistent if a socket event was dropped (e.g. transient network
  // issue between server and client) or arrives out of order. The
  // load() helper is idempotent, so duplicate reloads are harmless.
  useEffect(() => {
    if (!counterId) return;
    const t = setInterval(() => load(), 60_000);
    return () => clearInterval(t);
  }, [counterId, load]);

  // Audio cue (gated behind user interaction so browsers don't block it).
  const unlockAudio = useCallback(() => {
    try {
      if (!audioCtx.current) {
        const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        audioCtx.current = new Ctor();
      }
      if (audioCtx.current.state === "suspended") audioCtx.current.resume();
    } catch {
      /* ignore */
    }
  }, []);
  const beep = useCallback(() => {
    try {
      if (!audioCtx.current) return;
      const ctx = audioCtx.current;
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = "sine";
      o.frequency.value = 880;
      o.connect(g);
      g.connect(ctx.destination);
      g.gain.setValueAtTime(0.001, ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.18, ctx.currentTime + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.5);
      o.start();
      o.stop(ctx.currentTime + 0.5);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    if (!sock || !counterId) return;
    function onNew(e: OrderNewEvent) {
      if (e.counterId !== counterId) return;
      load();
      toast.push(`New ticket ${e.token}`, "info");
      beep();
    }
    function onStatus(e: OrderStatusEvent) {
      if (e.counterId !== counterId) return;
      // Smoothly move the card instead of re-rendering the whole column.
      if (orderEls.current[e.orderId]) {
        orderEls.current[e.orderId]!.animate(
          [
            { boxShadow: "0 0 0 3px rgba(16, 185, 129, 0.5)" },
            { boxShadow: "0 0 0 0 rgba(16, 185, 129, 0)" },
          ],
          { duration: 900, easing: "ease-out" }
        );
      }
      load();
    }
    sock.on(EV.orderNew, onNew);
    sock.on(EV.orderStatus, onStatus);
    return () => {
      sock.off(EV.orderNew, onNew);
      sock.off(EV.orderStatus, onStatus);
    };
  }, [sock, counterId, load, beep, toast]);

  async function act(orderId: string, kind: "start" | "ready") {
    setBusyId(orderId);
    try {
      const res = await fetch(`/api/kitchen/orders/${orderId}/${kind}`, { method: "POST" });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        toast.push(j.error ?? "Action failed", "error");
      } else {
        load();
      }
    } catch {
      toast.push("Network error", "error");
    } finally {
      setBusyId(null);
    }
  }

  const byCol = useMemo(() => {
    const groups: Record<Column, OrderRow[]> = { APPROVED: [], PREPARING: [], READY: [] };
    for (const o of orders) {
      if (o.status === "APPROVED" || o.status === "PREPARING" || o.status === "READY") {
        groups[o.status].push(o);
      }
    }
    // stable sort by createdAt asc — oldest first
    for (const k of Object.keys(groups) as Column[]) {
      groups[k].sort((a, b) => +new Date(a.createdAt) - +new Date(b.createdAt));
    }
    return groups;
  }, [orders]);

  return (
    <div className="page-bg min-h-screen" onPointerDown={unlockAudio}>
      <AppHeader
        title="Kitchen display"
        subtitle={
          counters.find((c) => c.id === counterId)?.name ?? "Loading counters…"
        }
        backHref="/"
        backLabel="Home"
        right={
          <>
            <ConnectionPill className="hidden sm:inline-flex" />
            {counterId ? (
              <select
                aria-label="Select counter"
                value={counterId}
                onChange={(e) => setCounterId(e.target.value)}
                className="select hidden sm:block"
                style={{ minWidth: 200 }}
              >
                {counters.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            ) : null}
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => load()}
              aria-label="Refresh"
            >
              <Icon.Refresh size={14} aria-hidden /> Refresh
            </button>
          </>
        }
      />

      <div className="app-container py-4">
        {counterId ? (
          <div className="mb-3 sm:hidden">
            <label className="field-label" htmlFor="kitchen-counter">Counter</label>
            <select
              id="kitchen-counter"
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

        {loadState === "error" ? (
          <ErrorPanel
            title="Couldn’t load orders"
            description="Please check your connection and try again."
            onRetry={() => load()}
          />
        ) : loadState === "loading" && orders.length === 0 ? (
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-3" aria-busy="true">
            {COLUMNS.map((c) => (
              <div key={c.key} className="space-y-2">
                <div className="skeleton h-6 w-32" />
                <div className="skeleton h-32 w-full" />
                <div className="skeleton h-32 w-full" />
              </div>
            ))}
          </div>
        ) : orders.length === 0 ? (
          <EmptyState
            icon="Chef"
            title="Kitchen is all caught up"
            description="When the cashier approves an order, it will appear here."
          />
        ) : (
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
            {COLUMNS.map((c) => {
              const list = byCol[c.key];
              return (
                <section
                  key={c.key}
                  aria-labelledby={`col-${c.key}`}
                  className="rounded-2xl border p-3"
                  style={{ background: "var(--surface)", borderColor: "var(--border-soft)" }}
                >
                  <div className="flex items-center justify-between px-1 pb-2">
                    <h2 id={`col-${c.key}`} className="text-sm font-semibold text-ink-900">
                      {c.title}
                      <span className="ml-1.5 text-xs font-normal text-ink-500">({list.length})</span>
                    </h2>
                    <span
                      className="inline-block h-2 w-2 rounded-full"
                      style={{ background: c.tone }}
                      aria-hidden
                    />
                  </div>
                  <p className="px-1 text-xs text-ink-500">{c.description}</p>
                  {list.length === 0 ? (
                    <div
                      className="mt-3 grid place-items-center rounded-xl border border-dashed py-6 text-xs text-ink-500"
                      style={{ borderColor: "var(--border-soft)" }}
                    >
                      Nothing here
                    </div>
                  ) : (
                    <ul className="mt-2 space-y-2">
                      {list.map((o) => {
                        const ageMin = relMinutes(o.createdAt);
                        const hot = ageMin >= 5;
                        const busy = busyId === o.id;
                        return (
                          <li
                            key={o.id}
                            ref={(el) => {
                              orderEls.current[o.id] = el;
                            }}
                            className={`card p-3 ${hot ? "ring-amber-300" : ""}`}
                            style={
                              hot
                                ? { borderColor: "var(--amber-300)", boxShadow: "0 0 0 1px var(--amber-200) inset" }
                                : undefined
                            }
                          >
                            <div className="flex items-center justify-between gap-2">
                              <div
                                className="token-display text-3xl"
                                style={{ color: "var(--forest-800)" }}
                              >
                                {o.token}
                              </div>
                              <div className="flex flex-col items-end gap-1">
                                <span
                                  className={hot ? "chip chip-warning" : "chip"}
                                  title={new Date(o.createdAt).toLocaleTimeString()}
                                >
                                  {hot ? <Icon.Flame size={12} aria-hidden /> : <Icon.Clock size={12} aria-hidden />}
                                  {relText(ageMin)}
                                </span>
                                <span className="text-[10px] text-ink-500">
                                  {o.items.reduce((s, i) => s + i.qty, 0)} pcs
                                </span>
                              </div>
                            </div>
                            <ul className="mt-2 space-y-1 text-sm">
                              {o.items.map((it) => (
                                <li
                                  key={it.menuItemId}
                                  className="flex items-center justify-between"
                                >
                                  <span className="text-ink-900">{it.name}</span>
                                  <span className="text-base font-bold text-ink-900 text-mono-num">
                                    × {it.qty}
                                  </span>
                                </li>
                              ))}
                            </ul>
                            <div className="mt-3 flex gap-2">
                              {o.status === "APPROVED" ? (
                                <button
                                  type="button"
                                  className="btn btn-primary btn-block btn-lg"
                                  onClick={() => act(o.id, "start")}
                                  disabled={busy}
                                  aria-busy={busy || undefined}
                                >
                                  {busy ? <span className="spinner" aria-hidden /> : <Icon.Chef size={16} aria-hidden />}
                                  Start
                                </button>
                              ) : o.status === "PREPARING" ? (
                                <button
                                  type="button"
                                  className="btn btn-amber btn-block btn-lg"
                                  onClick={() => act(o.id, "ready")}
                                  disabled={busy}
                                  aria-busy={busy || undefined}
                                >
                                  {busy ? <span className="spinner" aria-hidden /> : <Icon.Check size={16} aria-hidden />}
                                  Mark ready
                                </button>
                              ) : (
                                <span className="chip chip-success">
                                  <Icon.Check size={12} aria-hidden /> Awaiting pickup
                                </span>
                              )}
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </section>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
