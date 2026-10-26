"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import Link from "next/link";
import { useCart } from "@/hooks/useCart";
import { useToast } from "@/components/Toast";
import { useSocket } from "@/hooks/useSocket";
import { EV, type MenuAvailabilityEvent } from "@/lib/socket-events";
import { FoodCard, type FoodCardItem } from "@/components/ui/FoodCard";
import { Money } from "@/components/ui/Money";
import { Icon } from "@/components/ui/Icon";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorPanel } from "@/components/ui/ErrorPanel";
import { ConnectionPill } from "@/components/ui/ConnectionPill";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";

interface CounterInfo {
  id: string;
  slug: string;
  name: string;
}

interface MenuItem extends FoodCardItem {
  // imageUrl, description are inherited from FoodCardItem
}

const CATEGORY_KEYWORDS: Array<{ key: string; label: string; match: (n: string) => boolean }> = [
  { key: "all", label: "All", match: () => true },
  { key: "rice", label: "Rice & Biryani", match: (n) => /biryani|tehari|rice|pulao|khichuri/i.test(n) },
  { key: "curry", label: "Curry", match: (n) => /curry|daal|dal|daal/i.test(n) },
  { key: "snack", label: "Snacks", match: (n) => /sandwich|roll|fries|donut|snack/i.test(n) },
  { key: "drink", label: "Drinks", match: (n) => /coke|water|coffee|lassi|drink|juice|tea/i.test(n) },
  { key: "side", label: "Sides", match: (n) => /salad|roti|side/i.test(n) },
];

export default function MenuClient({ slug }: { slug: string }) {
  const [data, setData] = useState<{ counter: CounterInfo; menu: MenuItem[] } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [asking, setAsking] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitErr, setSubmitErr] = useState<string | null>(null);
  const [guestPhone, setGuestPhone] = useState("");
  const [guestName, setGuestName] = useState("");
  const [phoneErr, setPhoneErr] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string>("all");
  const cart = useCart();
  const toast = useToast();
  const sock = useSocket();

  const load = useCallback(
    async (signal?: AbortSignal) => {
      setErr(null);
      try {
        const res = await fetch(`/api/counters/${slug}`, { signal });
        if (!res.ok) {
          if (res.status === 404) setErr("Counter not found");
          else setErr("We couldn’t load the menu. Please try again.");
          return;
        }
        const json = await res.json();
        setData(json);
      } catch (e) {
        if ((e as { name?: string })?.name === "AbortError") return;
        setErr("Network error. Please check your connection and retry.");
      }
    },
    [slug]
  );

  useEffect(() => {
    const ctl = new AbortController();
    load(ctl.signal);
    return () => ctl.abort();
  }, [load, reloadKey]);

  // Live updates: refresh when an order is placed anywhere on this counter
  // (so stock decrements) and when the cashier changes an item's availability
  // or stock from the dashboard. The student joins the public menu room
  // for the second case, which is the only one carrying menu:availability
  // events; order events flow through the per-order room on the order
  // tracking page.
  useEffect(() => {
    if (!sock || !data?.counter?.id) return;
    sock.emit("join:menu", data.counter.id);
    function onAvail(e: MenuAvailabilityEvent) {
      if (e.counterId !== data?.counter?.id) return;
      load();
    }
    sock.on(EV.menuAvailability, onAvail);
    return () => {
      sock.off(EV.menuAvailability, onAvail);
    };
  }, [sock, data?.counter?.id, load]);

  const categories = useMemo(() => {
    if (!data) return [];
    const names = data.menu.map((m) => m.name);
    return CATEGORY_KEYWORDS.filter((c) => c.key === "all" || names.some((n) => c.match(n)));
  }, [data]);

  const visible = useMemo(() => {
    if (!data) return [];
    return data.menu
      .filter((m) => {
        if (category === "all") return true;
        const cat = CATEGORY_KEYWORDS.find((c) => c.key === category);
        return cat ? cat.match(m.name) : true;
      })
      .filter((m) => {
        if (!query.trim()) return true;
        return m.name.toLowerCase().includes(query.trim().toLowerCase());
      });
  }, [data, category, query]);

  const totalCount = cart.lines.reduce((s, l) => s + l.qty, 0);

  function submit() {
    if (cart.lines.length === 0) return;
    if (guestPhone && !/^[\d+\-\s()]{6,20}$/.test(guestPhone)) {
      setPhoneErr("Please enter a valid phone number");
      return;
    }
    setPhoneErr(null);
    setSubmitting(true);
    setSubmitErr(null);
    fetch("/api/orders", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        counterSlug: slug,
        items: cart.lines.map((l) => ({ menuItemId: l.menuItemId, qty: l.qty })),
        guestPhone: guestPhone || undefined,
        guestName: guestName || undefined,
      }),
    })
      .then(async (res) => {
        const json = await res.json().catch(() => ({}));
        if (!res.ok) {
          if (json.error === "stock_short") {
            toast.push("Some items just went out of stock — please retry", "error");
          } else if (json.error === "item_unavailable") {
            toast.push(`${json.name ?? "An item"} is unavailable`, "error");
          } else {
            toast.push("Could not place order", "error");
          }
          // refresh menu so the cart shows fresh stock
          load();
          setAsking(false);
          return;
        }
        cart.clear();
        toast.push(`Order ${json.order.token} placed`, "success");
        // The tracking URL carries a per-order HMAC token that proves the
        // requester has the link issued at order time. Without it the
        // detail API returns 403. The token is bound to the order id, so
        // leaking it to one order can't be replayed against another.
        const tokenParam = json.orderToken ? `?t=${encodeURIComponent(json.orderToken)}` : "";
        window.location.href = `/orders/${json.order.id}${tokenParam}`;
      })
      .catch(() => {
        setSubmitErr("Network error. Your order was not sent. Please retry.");
        setAsking(false);
      })
      .finally(() => {
        setSubmitting(false);
      });
  }

  if (err === "Counter not found") {
    return (
      <div className="app-container py-6">
        <ErrorPanel
          title="Counter not found"
          description={`There's no counter at /${slug}. Check the QR code or the link.`}
          action={
            <Link href="/" className="btn btn-primary btn-sm">
              Back to home
            </Link>
          }
        />
      </div>
    );
  }
  if (err) {
    return (
      <div className="app-container py-6">
        <ErrorPanel
          title="We can't load this menu"
          description={err}
          onRetry={() => setReloadKey((k) => k + 1)}
        />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="app-container py-6">
        <div className="skeleton mb-4 h-24 w-full rounded-2xl" />
        <div className="mb-3 flex gap-2">
          {[80, 64, 72, 60].map((w, i) => (
            <div key={i} className="skeleton h-8 rounded-full" style={{ width: w }} />
          ))}
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="card overflow-hidden">
              <div className="skeleton aspect-[4/3] w-full" />
              <div className="space-y-2 p-4">
                <div className="skeleton h-4 w-2/3" />
                <div className="skeleton h-3 w-full" />
                <div className="skeleton h-3 w-3/4" />
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div>
      <header
        className="sticky top-0 z-30 glass"
        style={{ borderBottom: "1px solid var(--border-soft)" }}
      >
        <div className="app-container py-3">
          <div className="flex items-center gap-3">
            <Link
              href="/"
              className="btn btn-ghost btn-sm"
              aria-label="Back to home"
            >
              <Icon.ChevronLeft size={16} aria-hidden /> Home
            </Link>
            <div className="min-w-0 flex-1">
              <h1 className="truncate text-base font-semibold text-ink-900 sm:text-lg">
                {data.counter.name}
              </h1>
              <div className="flex items-center gap-1.5 text-xs text-ink-500">
                <Icon.QrCode size={12} aria-hidden /> Code: <span className="font-mono">{data.counter.slug}</span>
              </div>
            </div>
            <ConnectionPill className="hidden sm:inline-flex" />
          </div>
        </div>
      </header>

      <div className="app-container py-4">
        <div className="flex items-center gap-2">
          <label className="relative flex-1">
            <span className="sr-only">Search menu</span>
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-400" aria-hidden>
              <Icon.Search size={16} />
            </span>
            <input
              className="input pl-9"
              type="search"
              placeholder="Search dishes"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label="Search dishes"
            />
          </label>
          <button
            type="button"
            className="btn btn-ghost btn-icon"
            onClick={() => setReloadKey((k) => k + 1)}
            aria-label="Refresh menu"
            title="Refresh menu"
          >
            <Icon.Refresh size={16} aria-hidden />
          </button>
        </div>

        {categories.length > 1 ? (
          <div className="mt-3 -mx-1 flex gap-2 overflow-x-auto px-1 pb-1" role="tablist" aria-label="Categories">
            {categories.map((c) => {
              const active = c.key === category;
              return (
                <button
                  key={c.key}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setCategory(c.key)}
                  className={
                    active
                      ? "shrink-0 rounded-full px-3.5 py-1.5 text-sm font-semibold"
                      : "shrink-0 rounded-full bg-cream-200 px-3.5 py-1.5 text-sm font-medium text-ink-700 hover:bg-cream-300"
                  }
                  style={active ? { background: "var(--forest-700)", color: "white" } : undefined}
                >
                  {c.label}
                </button>
              );
            })}
          </div>
        ) : null}

        {visible.length === 0 ? (
          <div className="mt-6">
            <EmptyState
              icon="Search"
              title={query ? `No results for “${query}”` : "No items in this category"}
              description="Try a different category or clear your search."
              action={
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => {
                    setQuery("");
                    setCategory("all");
                  }}
                >
                  Clear filters
                </button>
              }
            />
          </div>
        ) : (
          <ul
            className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3"
            aria-label="Menu"
          >
            {visible.map((m) => {
              const line = cart.lines.find((l) => l.menuItemId === m.id);
              const qty = line?.qty ?? 0;
              const remaining = m.isAvailable ? m.stockRemaining - qty : 0;
              const canAdd = m.isAvailable && remaining > 0;
              return (
                <li key={m.id}>
                  <FoodCard
                    item={m}
                    qty={qty}
                    onAdd={() => cart.add({ menuItemId: m.id, name: m.name, unitPrice: m.price })}
                    onIncrement={
                      canAdd
                        ? () => cart.setQty(m.id, Math.min(20, qty + 1))
                        : undefined
                    }
                    onDecrement={() => cart.setQty(m.id, Math.max(0, qty - 1))}
                  />
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* Floating cart bar */}
      {cart.lines.length > 0 && (
        <div
          className="fixed inset-x-0 bottom-0 z-40"
          style={{ paddingBottom: "max(0px, env(safe-area-inset-bottom))" }}
        >
          <div className="mx-auto max-w-3xl px-3 pb-3">
            <div className="glass-strong rounded-2xl p-3">
              <div className="flex items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-3">
                  <span
                    className="grid h-10 w-10 shrink-0 place-items-center rounded-xl"
                    style={{ background: "var(--forest-700)", color: "white" }}
                    aria-hidden
                  >
                    <Icon.Cart size={18} aria-hidden />
                  </span>
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-ink-900">
                      {totalCount} item{totalCount === 1 ? "" : "s"} in your order
                    </div>
                    <div className="truncate text-xs text-ink-500">
                      {cart.lines
                        .slice(0, 2)
                        .map((l) => `${l.name} × ${l.qty}`)
                        .join(", ")}
                      {cart.lines.length > 2 ? ` +${cart.lines.length - 2} more` : ""}
                    </div>
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-xs text-ink-500">Total</div>
                  <div className="text-base font-bold text-ink-900 text-mono-num">
                    <Money minor={cart.total} />
                  </div>
                </div>
              </div>
              <div className="mt-3 flex gap-2">
                <button
                  type="button"
                  onClick={cart.clear}
                  className="btn btn-ghost btn-sm"
                  aria-label="Clear cart"
                >
                  Clear
                </button>
                <button
                  type="button"
                  onClick={() => setAsking(true)}
                  className="btn btn-primary btn-block btn-lg"
                >
                  Place order <Icon.ArrowRight size={16} aria-hidden />
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Checkout dialog */}
      <ConfirmDialog
        open={asking}
        title="Almost there"
        description="Add your contact so the kitchen can ping you when your order is ready. You can skip and order anonymously."
        confirmLabel={submitting ? "Placing…" : "Confirm order"}
        cancelLabel="Back"
        loading={submitting}
        onCancel={() => !submitting && setAsking(false)}
        onConfirm={submit}
      >
        <div className="space-y-2">
          <div className="field">
            <label className="field-label" htmlFor="guest-name">Name (optional)</label>
            <input
              id="guest-name"
              className="input"
              type="text"
              autoComplete="name"
              placeholder="e.g. Tanbin"
              value={guestName}
              maxLength={60}
              onChange={(e) => setGuestName(e.target.value)}
            />
          </div>
          <div className="field">
            <label className="field-label" htmlFor="guest-phone">Phone (optional)</label>
            <input
              id="guest-phone"
              className="input"
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              placeholder="e.g. 01712345678"
              value={guestPhone}
              maxLength={20}
              onChange={(e) => {
                setGuestPhone(e.target.value);
                if (phoneErr) setPhoneErr(null);
              }}
              aria-invalid={phoneErr ? true : undefined}
              aria-describedby={phoneErr ? "phone-err" : undefined}
            />
            {phoneErr ? (
              <span id="phone-err" className="field-error" role="alert">
                {phoneErr}
              </span>
            ) : (
              <span className="field-hint">Only used for this order.</span>
            )}
          </div>
          {submitErr ? (
            <div
              className="rounded-lg p-2 text-xs"
              style={{ background: "var(--danger-100)", color: "var(--danger-600)" }}
              role="alert"
            >
              {submitErr}
            </div>
          ) : null}
        </div>
      </ConfirmDialog>
    </div>
  );
}
