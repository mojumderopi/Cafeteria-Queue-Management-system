"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSocket } from "@/hooks/useSocket";
import { EV, ROOMS, type OrderNewEvent, type OrderStatusEvent } from "@/lib/socket-events";
import { useToast } from "@/components/Toast";

interface OrderRow {
  id: string;
  token: string;
  counterId: string;
  status: string;
  totalCents: number;
  priorityScore: number;
  createdAt: string;
  approvedAt: string | null;
  readyAt: string | null;
  items: { menuItemId: string; name: string; qty: number; unitPrice: number }[];
}
interface CounterRow { id: string; slug: string; name: string }

export default function KitchenBoard() {
  const [counters, setCounters] = useState<CounterRow[]>([]);
  const [counterId, setCounterId] = useState<string | null>(null);
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [tick, setTick] = useState(0);
  const toast = useToast();
  const sock = useSocket();
  const audioCtx = useRef<AudioContext | null>(null);

  useEffect(() => {
    fetch("/api/staff/counters").then((r) => r.json()).then((j) => {
      setCounters(j.counters ?? []);
      if (j.counters?.[0]) setCounterId(j.counters[0].id);
    });
  }, []);

  const beep = useCallback(() => {
    try {
      if (!audioCtx.current) audioCtx.current = new (window.AudioContext || (window as any).webkitAudioContext)();
      const ctx = audioCtx.current!;
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = "sine"; o.frequency.value = 880;
      o.connect(g); g.connect(ctx.destination);
      g.gain.setValueAtTime(0.001, ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.2, ctx.currentTime + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.4);
      o.start(); o.stop(ctx.currentTime + 0.4);
    } catch {}
  }, []);

  const load = useCallback(async () => {
    if (!counterId) return;
    const res = await fetch(`/api/staff/orders?counterId=${counterId}&status=APPROVED,PREPARING`);
    const j = await res.json();
    setOrders(j.orders ?? []);
  }, [counterId]);

  useEffect(() => {
    if (!counterId) return;
    load();
    if (sock) sock.emit("join:counter", counterId);
  }, [counterId, sock, load]);

  useEffect(() => {
    const t = setInterval(() => setTick((x) => x + 1), 30_000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (!sock || !counterId) return;
    function onNew(_e: OrderNewEvent) { load(); }
    function onStatus(e: OrderStatusEvent) {
      if (e.counterId !== counterId) return;
      if (e.status === "APPROVED") {
        toast.push(`New ticket ${e.token}`, "info");
        beep();
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
    const url = `/api/kitchen/orders/${orderId}/${kind}`;
    const res = await fetch(url, { method: "POST" });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      toast.push(j.error ?? "Action failed", "error");
    } else {
      load();
    }
  }

  return (
    <main className="mx-auto max-w-6xl px-4 py-6">
      <div className="flex items-center justify-between">
        <div>
          <Link href="/" className="text-xs text-stone-500 hover:underline">← Home</Link>
          <h1 className="text-2xl font-bold">Kitchen</h1>
        </div>
        <div className="flex gap-2">
          <select
            value={counterId ?? ""}
            onChange={(e) => setCounterId(e.target.value)}
            className="rounded-xl border border-stone-300 px-3 py-2 text-sm"
          >
            {counters.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
      </div>

      {orders.length === 0 ? (
        <div className="card mt-8 text-center text-stone-500">No active tickets.</div>
      ) : (
        <ul className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {orders.map((o) => {
            const ageMin = Math.max(0, Math.floor((Date.now() - new Date(o.createdAt).getTime()) / 60000));
            const hot = ageMin >= 5;
            return (
              <li key={o.id} className={`card ${hot ? "ring-amber-300" : ""}`} data-tick={tick}>
                <div className="flex items-center justify-between">
                  <div className="text-3xl font-black text-brand-600">{o.token}</div>
                  <div className={`chip ${hot ? "bg-amber-200 text-amber-900" : ""}`}>{ageMin}m wait</div>
                </div>
                <ul className="mt-2">
                  {o.items.map((it) => (
                    <li key={it.menuItemId} className="flex justify-between text-sm">
                      <span>{it.name}</span>
                      <span className="font-semibold">× {it.qty}</span>
                    </li>
                  ))}
                </ul>
                <div className="mt-3 flex gap-2">
                  {o.status === "APPROVED" && (
                    <button className="btn-primary flex-1" onClick={() => act(o.id, "start")}>Start</button>
                  )}
                  {o.status === "PREPARING" && (
                    <button className="btn-primary flex-1" onClick={() => act(o.id, "ready")}>Mark ready</button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}