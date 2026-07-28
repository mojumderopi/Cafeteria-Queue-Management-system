"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useCart } from "@/hooks/useCart";
import { useToast } from "@/components/Toast";

interface MenuItem {
  id: string;
  name: string;
  description: string | null;
  price: number;
  isAvailable: boolean;
  stockRemaining: number;
  lowStockThreshold: number;
  imageUrl: string | null;
}

interface CounterInfo { id: string; slug: string; name: string }

export default function MenuClient({ slug }: { slug: string }) {
  const [data, setData] = useState<{ counter: CounterInfo; menu: MenuItem[] } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const [guestPhone, setGuestPhone] = useState("");
  const [guestName, setGuestName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const cart = useCart();
  const toast = useToast();

  useEffect(() => {
    fetch(`/api/counters/${slug}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then(setData)
      .catch(() => setErr("Counter not found"));
  }, [slug]);

  const byId = useMemo(() => new Map((data?.menu ?? []).map((m) => [m.id, m])), [data]);

  if (err) {
    return <div className="card mt-10 text-center text-stone-600">{err}</div>;
  }
  if (!data) {
    return <div className="space-y-3 mt-6">{[...Array(6)].map((_, i) => (
      <div key={i} className="card animate-pulse h-20" />
    ))}</div>;
  }

  async function submit() {
    if (cart.lines.length === 0) return;
    setSubmitting(true);
    try {
      const res = await fetch("/api/orders", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          counterSlug: slug,
          items: cart.lines.map((l) => ({ menuItemId: l.menuItemId, qty: l.qty })),
          guestPhone: guestPhone || undefined,
          guestName: guestName || undefined,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        if (json.error === "stock_short") {
          toast.push("Some items just went out of stock — please retry", "error");
        } else if (json.error === "item_unavailable") {
          toast.push(`${json.name ?? "An item"} is unavailable`, "error");
        } else {
          toast.push("Could not place order", "error");
        }
        // refresh menu
        const r = await fetch(`/api/counters/${slug}`);
        if (r.ok) setData(await r.json());
        return;
      }
      cart.clear();
      window.location.href = `/orders/${json.order.id}`;
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <Link href="/" className="text-xs text-stone-500 hover:underline">← Home</Link>
          <h1 className="text-2xl font-bold">{data.counter.name}</h1>
        </div>
        <div className="chip">QR: {data.counter.slug}</div>
      </div>

      <ul className="mt-4 space-y-3">
        {data.menu.map((m) => (
          <li key={m.id} className="card flex items-center justify-between gap-3">
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <h3 className="font-semibold">{m.name}</h3>
                {!m.isAvailable && <span className="chip bg-stone-200">Unavailable</span>}
                {m.isAvailable && m.stockRemaining <= m.lowStockThreshold && (
                  <span className="chip bg-amber-100 text-amber-800">{m.stockRemaining} left</span>
                )}
              </div>
              {m.description && <p className="text-sm text-stone-600">{m.description}</p>}
              <div className="mt-1 text-sm text-stone-700">৳{(m.price / 100).toFixed(2)}</div>
            </div>
            <button
              disabled={!m.isAvailable}
              onClick={() => cart.add({ menuItemId: m.id, name: m.name, unitPrice: m.price })}
              className="btn-primary disabled:bg-stone-200 disabled:text-stone-500"
            >
              Add
            </button>
          </li>
        ))}
      </ul>

      {cart.lines.length > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-stone-200 bg-white p-4 shadow-2xl">
          <div className="mx-auto max-w-2xl">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="font-semibold">Your order</h3>
              <button className="text-xs text-stone-500 underline" onClick={cart.clear}>Clear</button>
            </div>
            <ul className="space-y-1 text-sm">
              {cart.lines.map((l) => {
                const m = byId.get(l.menuItemId);
                const left = m?.stockRemaining ?? 0;
                return (
                  <li key={l.menuItemId} className="flex items-center justify-between">
                    <span>{l.name} × {l.qty}</span>
                    <span className="flex items-center gap-2">
                      <button className="btn-ghost px-2 py-1" onClick={() => cart.setQty(l.menuItemId, l.qty - 1)}>−</button>
                      <span className="w-6 text-center">{l.qty}</span>
                      <button
                        className="btn-ghost px-2 py-1 disabled:opacity-50"
                        disabled={l.qty >= left}
                        onClick={() => cart.setQty(l.menuItemId, l.qty + 1)}
                      >+</button>
                      <span className="w-16 text-right">৳{(l.unitPrice * l.qty / 100).toFixed(2)}</span>
                    </span>
                  </li>
                );
              })}
            </ul>
            <div className="mt-3 flex items-center justify-between">
              <div className="text-sm text-stone-600">Total</div>
              <div className="text-lg font-bold">৳{(cart.total / 100).toFixed(2)}</div>
            </div>
            <button
              onClick={() => setAsking(true)}
              className="btn-primary mt-3 w-full"
            >
              Place order (pay cash on pickup)
            </button>
          </div>
        </div>
      )}

      {asking && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setAsking(false)}>
          <div className="card w-full max-w-md" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-semibold">One quick thing</h3>
            <p className="mt-1 text-sm text-stone-600">Optional: leave your phone so we can ping you about your order. You can skip this.</p>
            <input
              className="mt-3 w-full rounded-xl border border-stone-300 px-3 py-2"
              placeholder="Phone (optional)"
              value={guestPhone}
              onChange={(e) => setGuestPhone(e.target.value)}
            />
            <input
              className="mt-2 w-full rounded-xl border border-stone-300 px-3 py-2"
              placeholder="Name (optional)"
              value={guestName}
              onChange={(e) => setGuestName(e.target.value)}
            />
            <div className="mt-4 flex gap-2">
              <button className="btn-ghost flex-1" onClick={() => setAsking(false)}>Cancel</button>
              <button className="btn-primary flex-1" disabled={submitting} onClick={submit}>
                {submitting ? "Placing…" : "Confirm order"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}