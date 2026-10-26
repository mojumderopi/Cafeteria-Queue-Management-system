"use client";
// Admin sales analytics dashboard.
//
// Read-only. Shows:
//   - Overview cards (sales, completed orders, pending, average order value, items sold)
//   - Best-selling items (toggle: by quantity / by revenue)
//   - Per-counter comparison
//   - Historical order browser
//
// All numbers are derived from orders where status = COMPLETED and
// paymentStatus = PAID. Revenue uses OrderItem.unitPrice snapshots, not
// today's menu price.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { AppHeader } from "@/components/ui/AppHeader";
import { Money } from "@/components/ui/Money";
import { Icon } from "@/components/ui/Icon";
import { ErrorPanel } from "@/components/ui/ErrorPanel";
import { EmptyState } from "@/components/ui/EmptyState";
import { ConnectionPill } from "@/components/ui/ConnectionPill";
import { useSocket } from "@/hooks/useSocket";
import { useToast } from "@/components/Toast";

type RangeKey = "today" | "week" | "month" | "custom";

interface Overview {
  range: { from: string; to: string };
  salesCents: number;
  completedOrders: number;
  pendingOrders: number;
  itemsSold: number;
  avgOrderCents: number;
}

interface BestRow {
  menuItemId: string;
  name: string;
  imageUrl: string | null;
  counterId: string | null;
  qty: number;
  revenueCents: number;
}

interface CounterRow {
  counterId: string;
  name: string;
  slug: string;
  salesCents: number;
  completedOrders: number;
  avgOrderCents: number;
  bestItem: { menuItemId: string; name: string; revenueCents: number; qty: number } | null;
}

interface ProviderRow {
  providerId: string;
  slug: string;
  name: string;
  salesCents: number;
  completedOrders: number;
  avgOrderCents: number;
  bestItem: { menuItemId: string; name: string; revenueCents: number; qty: number } | null;
}

function rangeOf(key: RangeKey, customFrom?: string, customTo?: string) {
  const now = new Date();
  const end = new Date(now.getTime() + 60_000);
  if (key === "today") {
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    return { from: start, to: end };
  }
  if (key === "week") {
    const start = new Date(now);
    start.setDate(start.getDate() - 6);
    start.setHours(0, 0, 0, 0);
    return { from: start, to: end };
  }
  if (key === "month") {
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    return { from: start, to: end };
  }
  // custom
  if (customFrom && customTo) {
    return { from: new Date(customFrom), to: new Date(customTo) };
  }
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  return { from: start, to: end };
}

function toQS(from: Date, to: Date) {
  return `from=${encodeURIComponent(from.toISOString())}&to=${encodeURIComponent(to.toISOString())}`;
}

export default function AdminDashboard() {
  const sock = useSocket();
  const toast = useToast();
  const [role, setRole] = useState<"CASHIER" | "KITCHEN" | "ADMIN" | null>(null);
  const [rangeKey, setRangeKey] = useState<RangeKey>("today");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [overview, setOverview] = useState<Overview | null>(null);
  const [bestBy, setBestBy] = useState<"quantity" | "revenue">("quantity");
  const [best, setBest] = useState<BestRow[]>([]);
  const [counters, setCounters] = useState<CounterRow[]>([]);
  const [providers, setProviders] = useState<ProviderRow[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [errMsg, setErrMsg] = useState<string | null>(null);
  // Shared "component still mounted" flag. Both the /api/staff/me effect
  // and the reload() callback need to see the same value, so it lives
  // on a ref rather than being a let-bound local in either closure.
  const aliveRef = useRef(true);

  const range = useMemo(
    () => rangeOf(rangeKey, customFrom, customTo),
    [rangeKey, customFrom, customTo],
  );

  // Detect session. If the user is not ADMIN, show a "not authorized"
  // placeholder instead of trying to fetch analytics (which would 403).
  useEffect(() => {
    // Reset the ref on every effect invocation. This is critical under
    // React 18 strict mode, which runs each effect twice on mount in
    // development: the first cleanup would otherwise flip the ref to
    // false and the second invocation's fetch.then would silently drop
    // the setRole call.
    aliveRef.current = true;
    fetch("/api/staff/me")
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (aliveRef.current) setRole(j?.role ?? null);
      })
      .catch(() => {
        if (aliveRef.current) setRole(null);
      });
    return () => {
      aliveRef.current = false;
    };
  }, []);

  const reload = useCallback(async () => {
    if (role !== "ADMIN") return;
    setState("loading");
    setErrMsg(null);
    try {
      const qs = toQS(range.from, range.to);
      const [ov, bs, ct, pr] = await Promise.all([
        fetch(`/api/admin/analytics/overview?${qs}`).then((r) => (r.ok ? r.json() : Promise.reject(new Error(`${r.status}`)))),
        fetch(`/api/admin/analytics/bestsellers?${qs}&by=${bestBy}`).then((r) =>
          r.ok ? r.json() : Promise.reject(new Error(`${r.status}`)),
        ),
        fetch(`/api/admin/analytics/counters?${qs}`).then((r) =>
          r.ok ? r.json() : Promise.reject(new Error(`${r.status}`)),
        ),
        fetch(`/api/admin/analytics/providers?${qs}`).then((r) =>
          r.ok ? r.json() : Promise.reject(new Error(`${r.status}`)),
        ),
      ]);
      if (!aliveRef.current) return;
      setOverview(ov);
      setBest(bs.items ?? []);
      setCounters(ct.counters ?? []);
      setProviders(pr.providers ?? []);
      setState("ready");
    } catch (e) {
      setErrMsg((e as Error).message);
      setState("error");
    }
  }, [role, range, bestBy]);

  useEffect(() => {
    reload();
  }, [reload]);

  // Refresh automatically on new orders (any counter) so analytics feel live.
  useEffect(() => {
    if (!sock) return;
    function onNew() { reload(); }
    function onStatus() { reload(); }
    sock.on("order:new", onNew);
    sock.on("order:status", onStatus);
    return () => {
      sock.off("order:new", onNew);
      sock.off("order:status", onStatus);
    };
  }, [sock, reload]);

  // bestBy change triggers reload via useEffect dependency on reload.
  // We want to also reload when bestBy flips; reload's deps already
  // include bestBy, so the first useEffect above re-fires.

  if (role === null) {
    return (
      <div className="page-bg min-h-screen">
        <AppHeader title="Admin" backHref="/" backLabel="Home" right={<ConnectionPill />} />
        <div className="app-container py-6">
          <div className="card p-6 text-sm text-ink-700">Checking your access…</div>
        </div>
      </div>
    );
  }
  if (role !== "ADMIN") {
    return (
      <div className="page-bg min-h-screen">
        <AppHeader title="Admin" backHref="/" backLabel="Home" right={<ConnectionPill />} />
        <div className="app-container py-6">
          <div className="card p-6 text-sm text-ink-700">
            You need an admin account to view sales analytics.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="page-bg min-h-screen">
      <AppHeader
        title="Admin overview"
        subtitle="Sales, performance, and order history"
        backHref="/"
        backLabel="Home"
        right={
          <>
            <ConnectionPill className="hidden sm:inline-flex" />
            <Link href="/admin/menu" className="btn btn-ghost btn-sm">
              <Icon.Edit size={14} aria-hidden /> Manage menu
            </Link>
          </>
        }
      />

      <div className="app-container space-y-4 py-4">
        <div className="card flex flex-wrap items-center gap-2 p-3">
          <div className="inline-flex rounded-full p-1" style={{ background: "var(--cream-200)" }} role="tablist" aria-label="Date range">
            {(["today", "week", "month", "custom"] as RangeKey[]).map((k) => (
              <button
                key={k}
                type="button"
                role="tab"
                aria-selected={rangeKey === k}
                onClick={() => setRangeKey(k)}
                className="rounded-full px-3 py-1.5 text-sm font-semibold transition"
                style={
                  rangeKey === k
                    ? { background: "var(--forest-700)", color: "white", boxShadow: "var(--shadow-xs)" }
                    : { color: "var(--ink-700)" }
                }
              >
                {k === "today" ? "Today" : k === "week" ? "Last 7 days" : k === "month" ? "This month" : "Custom"}
              </button>
            ))}
          </div>
          {rangeKey === "custom" ? (
            <div className="flex flex-wrap items-center gap-2">
              <label className="text-xs text-ink-500">From</label>
              <input
                type="date"
                value={customFrom}
                onChange={(e) => setCustomFrom(e.target.value)}
                className="input"
              />
              <label className="text-xs text-ink-500">To</label>
              <input
                type="date"
                value={customTo}
                onChange={(e) => setCustomTo(e.target.value)}
                className="input"
              />
            </div>
          ) : null}
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => {
              reload();
              toast.push("Refreshed", "info");
            }}
          >
            <Icon.Refresh size={14} aria-hidden /> Refresh
          </button>
        </div>

        {state === "error" ? (
          <ErrorPanel
            title="Couldn’t load analytics"
            description={errMsg ?? "Please try again."}
            onRetry={reload}
          />
        ) : state === "loading" ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5" aria-busy="true">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="card space-y-2 p-4">
                <div className="skeleton h-3 w-1/2" />
                <div className="skeleton h-6 w-2/3" />
              </div>
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            <StatCard label="Sales" value={<Money minor={overview?.salesCents ?? 0} />} />
            <StatCard label="Completed orders" value={String(overview?.completedOrders ?? 0)} />
            <StatCard label="Pending" value={String(overview?.pendingOrders ?? 0)} />
            <StatCard label="Avg order value" value={<Money minor={overview?.avgOrderCents ?? 0} />} />
            <StatCard label="Items sold" value={String(overview?.itemsSold ?? 0)} />
          </div>
        )}

        <section className="grid gap-4 lg:grid-cols-2">
          <div className="card">
            <header className="flex items-center justify-between p-3">
              <h2 className="text-sm font-semibold text-ink-700">Best-selling items</h2>
              <div className="inline-flex rounded-full p-1" style={{ background: "var(--cream-200)" }} role="tablist" aria-label="Best sellers metric">
                {(["quantity", "revenue"] as const).map((k) => (
                  <button
                    key={k}
                    type="button"
                    role="tab"
                    aria-selected={bestBy === k}
                    onClick={() => setBestBy(k)}
                    className="rounded-full px-3 py-1.5 text-xs font-semibold transition"
                    style={
                      bestBy === k
                        ? { background: "var(--forest-700)", color: "white" }
                        : { color: "var(--ink-700)" }
                    }
                  >
                    {k === "quantity" ? "By quantity" : "By revenue"}
                  </button>
                ))}
              </div>
            </header>
            {best.length === 0 ? (
              <EmptyState title="No sales yet" description="Completed orders will appear here." />
            ) : (
              <ul className="divide-y" style={{ borderColor: "var(--border-soft)" }}>
                {best.map((row, i) => (
                  <li key={row.menuItemId} className="flex items-center gap-3 p-3">
                    <span className="grid h-7 w-7 place-items-center rounded-full text-xs font-semibold" style={{ background: "var(--cream-200)" }}>
                      {i + 1}
                    </span>
                    <div
                      className="grid h-12 w-16 place-items-center overflow-hidden rounded-md"
                      style={{ background: "var(--cream-200)" }}
                      aria-hidden
                    >
                      {row.imageUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={row.imageUrl} alt="" className="h-full w-full object-cover" />
                      ) : (
                        <Icon.Utensils size={20} />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-semibold text-ink-900">{row.name}</div>
                      <div className="text-xs text-ink-500">
                        {row.qty} sold · <Money minor={row.revenueCents} />
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="card">
            <header className="p-3">
              <h2 className="text-sm font-semibold text-ink-700">Provider comparison</h2>
            </header>
            {providers.length === 0 ? (
              <EmptyState title="No providers" description="No completed sales in the window." />
            ) : (
              <ul className="divide-y" style={{ borderColor: "var(--border-soft)" }}>
                {providers.map((p) => (
                  <li key={p.providerId} className="grid gap-1 p-3 sm:grid-cols-4 sm:items-center sm:gap-3">
                    <div className="sm:col-span-1">
                      <div className="text-sm font-semibold text-ink-900">{p.name}</div>
                      <div className="text-xs text-ink-500">/{p.slug}</div>
                    </div>
                    <Stat label="Sales" value={<Money minor={p.salesCents} />} />
                    <Stat label="Orders" value={String(p.completedOrders)} />
                    <Stat label="Top item" value={p.bestItem?.name ?? "—"} />
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="card">
            <header className="p-3">
              <h2 className="text-sm font-semibold text-ink-700">Counter comparison</h2>
            </header>
            {counters.length === 0 ? (
              <EmptyState title="No counters" description="No completed sales in the window." />
            ) : (
              <ul className="divide-y" style={{ borderColor: "var(--border-soft)" }}>
                {counters.map((c) => (
                  <li key={c.counterId} className="grid gap-1 p-3 sm:grid-cols-4 sm:items-center sm:gap-3">
                    <div className="sm:col-span-1">
                      <div className="text-sm font-semibold text-ink-900">{c.name}</div>
                      <div className="text-xs text-ink-500">/{c.slug}</div>
                    </div>
                    <Stat label="Sales" value={<Money minor={c.salesCents} />} />
                    <Stat label="Orders" value={String(c.completedOrders)} />
                    <Stat label="Top item" value={c.bestItem?.name ?? "—"} />
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>

        <HistoricalOrders qsBase={toQS(range.from, range.to)} />
      </div>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="card p-3">
      <div className="text-xs uppercase tracking-wide text-ink-500">{label}</div>
      <div className="mt-1 text-xl font-semibold text-ink-900">{value}</div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="text-[10px] uppercase tracking-wide text-ink-500">{label}</div>
      <div className="truncate text-sm font-semibold text-ink-900">{value}</div>
    </div>
  );
}

function HistoricalOrders({ qsBase }: { qsBase: string }) {
  const [counterId, setCounterId] = useState("");
  const [status, setStatus] = useState("");
  const [take, setTake] = useState(50);
  const [counters, setCounters] = useState<Array<{ id: string; name: string }>>([]);
  const [orders, setOrders] = useState<Array<{
    id: string;
    token: string;
    counter: { name: string; slug: string };
    status: string;
    paymentStatus: string;
    totalCents: number;
    createdAt: string;
    completedAt: string | null;
    items: Array<{ name: string; qty: number; unitPrice: number; archived: boolean }>;
  }> | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetch("/api/staff/counters")
      .then(async (r) => (r.ok ? r.json() : { counters: [] }))
      .then((j) => {
        if (alive) setCounters(j.counters ?? []);
      })
      .catch(() => {
        /* ignore */
      });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setErr(null);
    const qs = new URLSearchParams(qsBase);
    if (counterId) qs.set("counterId", counterId);
    if (status) qs.set("status", status);
    qs.set("take", String(take));
    fetch(`/api/admin/orders?${qs.toString()}`)
      .then(async (r) => {
        if (!r.ok) throw new Error(`${r.status}`);
        return r.json();
      })
      .then((j) => {
        if (alive) setOrders(j.orders ?? []);
      })
      .catch((e) => {
        if (alive) setErr((e as Error).message);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [qsBase, counterId, status, take]);

  return (
    <section className="card">
      <header className="flex flex-wrap items-center justify-between gap-2 p-3">
        <h2 className="text-sm font-semibold text-ink-700">Order history</h2>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <label>
            Counter
            <select
              className="select ml-1"
              value={counterId}
              onChange={(e) => setCounterId(e.target.value)}
            >
              <option value="">All</option>
              {counters.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Status
            <select className="select ml-1" value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">All</option>
              {[
                "PENDING_CASHIER",
                "APPROVED",
                "REJECTED",
                "PREPARING",
                "READY",
                "COMPLETED",
                "CANCELLED",
              ].map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
          <label>
            Take
            <select className="select ml-1" value={String(take)} onChange={(e) => setTake(Number(e.target.value))}>
              {[25, 50, 100, 200].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
        </div>
      </header>
      {err ? (
        <ErrorPanel title="Couldn’t load orders" description={`Status ${err}`} onRetry={() => {}} />
      ) : loading ? (
        <div className="p-3 text-sm text-ink-500" aria-busy="true">Loading…</div>
      ) : !orders || orders.length === 0 ? (
        <EmptyState title="No orders" description="No orders match the current filters." />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-ink-500">
                <th className="p-2">Token</th>
                <th className="p-2">Counter</th>
                <th className="p-2">Status</th>
                <th className="p-2">Payment</th>
                <th className="p-2 text-right">Total</th>
                <th className="p-2">When</th>
                <th className="p-2">Items</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((o) => (
                <tr key={o.id} className="border-t" style={{ borderColor: "var(--border-soft)" }}>
                  <td className="p-2 font-mono text-xs text-ink-900">{o.token}</td>
                  <td className="p-2 text-ink-700">{o.counter.name}</td>
                  <td className="p-2 text-ink-700">{o.status}</td>
                  <td className="p-2 text-ink-700">{o.paymentStatus}</td>
                  <td className="p-2 text-right text-mono-num text-ink-900">
                    <Money minor={o.totalCents} />
                  </td>
                  <td className="p-2 text-xs text-ink-500">{new Date(o.createdAt).toLocaleString()}</td>
                  <td className="p-2 text-xs text-ink-700">
                    {o.items.map((it, i) => (
                      <span key={i} className={it.archived ? "text-ink-400 line-through" : ""}>
                        {it.name} × {it.qty}
                        {i < o.items.length - 1 ? ", " : ""}
                      </span>
                    ))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
