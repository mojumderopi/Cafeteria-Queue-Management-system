"use client";
// Compact, order-first availability panel for the cashier dashboard.
//
// Displays the items at the active counter with three explicit states:
//   - Available (manual flag is on AND stock > 0)
//   - Out of stock (manual flag is on but Redis stock is zero)
//   - Manually disabled (manual flag is off; stock is irrelevant)
//
// Stock is set by the cashier in two interactions: select the row, type
// or use the stepper, hit Save. The Redis stock and the DB MenuItem.stockQty
// are updated together. The manual availability flag toggles with one
// click and survives a stock refill — you must explicitly re-enable.
//
// Subscribes to the existing `menu:availability` socket event so a
// change made from another tab is reflected immediately. Also re-fetches
// the list whenever the counterId changes.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useSocket } from "@/hooks/useSocket";
import { EV, type MenuAvailabilityEvent } from "@/lib/socket-events";
import { useToast } from "@/components/Toast";
import { Icon } from "@/components/ui/Icon";
import { Money } from "@/components/ui/Money";

interface ItemRow {
  id: string;
  counterId: string;
  name: string;
  imageUrl: string | null;
  price: number;
  isAvailable: boolean;
  stockQty: number;
  stockRemaining: number;
  lowStockThreshold: number;
  archived: boolean;
}

type State = "loading" | "ready" | "error";
type StockEdit = { value: string; saving: boolean };

export function CashierAvailability({
  counterId,
  isAdmin,
}: {
  counterId: string | null;
  isAdmin: boolean;
}) {
  const sock = useSocket();
  const toast = useToast();
  const [state, setState] = useState<State>("loading");
  const [errMsg, setErrMsg] = useState<string | null>(null);
  const [items, setItems] = useState<ItemRow[]>([]);
  const [q, setQ] = useState("");
  const [editing, setEditing] = useState<Record<string, StockEdit>>({});
  const [collapsed, setCollapsed] = useState(false);
  // Apply incoming socket events without re-fetching.
  const itemsRef = useRef(items);
  itemsRef.current = items;

  const reload = useCallback(async () => {
    if (!counterId) return;
    setState("loading");
    setErrMsg(null);
    try {
      const res = await fetch(
        `/api/admin/menu/items?counterId=${encodeURIComponent(counterId)}`,
      );
      if (!res.ok) {
        if (res.status === 403) {
          setErrMsg("Not authorized for this counter");
        } else {
          setErrMsg(`Failed to load (${res.status})`);
        }
        setState("error");
        return;
      }
      const data = (await res.json()) as { items: ItemRow[] };
      setItems(data.items);
      setState("ready");
    } catch (e) {
      setErrMsg((e as Error).message);
      setState("error");
    }
  }, [counterId]);

  useEffect(() => {
    if (counterId) reload();
  }, [counterId, reload]);

  // Live update from the same counter's broadcast.
  useEffect(() => {
    if (!sock) return;
    function onAvail(e: MenuAvailabilityEvent) {
      if (e.counterId !== counterId) return;
      setItems((prev) =>
        prev.map((it) =>
          it.id === e.itemId
            ? { ...it, isAvailable: e.isAvailable, stockRemaining: e.stockRemaining, archived: e.archived }
            : it,
        ),
      );
    }
    sock.on(EV.menuAvailability, onAvail);
    return () => {
      sock.off(EV.menuAvailability, onAvail);
    };
  }, [sock, counterId]);

  const filtered = useMemo(() => {
    const ql = q.trim().toLowerCase();
    if (!ql) return items.filter((i) => !i.archived);
    return items.filter((i) => !i.archived && i.name.toLowerCase().includes(ql));
  }, [items, q]);

  const counters = useMemo(() => {
    let available = 0;
    let outOfStock = 0;
    let disabled = 0;
    for (const it of items) {
      if (it.archived) continue;
      if (!it.isAvailable) disabled++;
      else if (it.stockRemaining <= 0) outOfStock++;
      else available++;
    }
    return { available, outOfStock, disabled };
  }, [items]);

  async function toggleAvailability(it: ItemRow) {
    const next = !it.isAvailable;
    // Optimistic update with rollback on error.
    setItems((prev) => prev.map((p) => (p.id === it.id ? { ...p, isAvailable: next } : p)));
    const res = await fetch(`/api/admin/menu/items/${it.id}/availability`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ isAvailable: next }),
    });
    if (!res.ok) {
      // Roll back.
      setItems((prev) => prev.map((p) => (p.id === it.id ? { ...p, isAvailable: it.isAvailable } : p)));
      const j = await res.json().catch(() => ({}));
      toast.push(j.error ?? "Could not update availability", "error");
    } else {
      toast.push(`${it.name} is now ${next ? "available" : "disabled"}`, "info");
    }
  }

  function startEdit(it: ItemRow) {
    setEditing((prev) => ({ ...prev, [it.id]: { value: String(it.stockRemaining), saving: false } }));
  }
  function cancelEdit(it: ItemRow) {
    setEditing((prev) => {
      const n = { ...prev };
      delete n[it.id];
      return n;
    });
  }
  function changeEdit(id: string, value: string) {
    setEditing((prev) => ({ ...prev, [id]: { ...(prev[id] ?? { value: "", saving: false }), value } }));
  }
  async function saveStock(it: ItemRow) {
    const edit = editing[it.id];
    if (!edit) return;
    const n = Number.parseInt(edit.value, 10);
    if (!Number.isInteger(n) || n < 0) {
      toast.push("Stock must be a non-negative integer", "error");
      return;
    }
    setEditing((prev) => ({ ...prev, [it.id]: { ...edit, saving: true } }));
    const res = await fetch(`/api/admin/menu/items/${it.id}/stock`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ qty: n }),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      toast.push(j.error ?? "Could not update stock", "error");
      setEditing((prev) => ({ ...prev, [it.id]: { ...edit, saving: false } }));
    } else {
      const j = (await res.json()) as { stockRemaining: number; stockQty: number };
      setItems((prev) =>
        prev.map((p) => (p.id === it.id ? { ...p, stockRemaining: j.stockRemaining, stockQty: j.stockQty } : p)),
      );
      setEditing((prev) => {
        const n2 = { ...prev };
        delete n2[it.id];
        return n2;
      });
      toast.push(`${it.name} stock set to ${j.stockRemaining}`, "info");
    }
  }

  if (!counterId) {
    return null;
  }

  return (
    <section className="mt-6">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold text-ink-700">Quick availability</h2>
          <span className="chip" aria-hidden>
            {counters.available} available
          </span>
          <span className="chip" aria-hidden>
            {counters.outOfStock} out of stock
          </span>
          <span className="chip" aria-hidden>
            {counters.disabled} disabled
          </span>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="search"
            placeholder="Search items"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="input w-44 sm:w-56"
            aria-label="Search menu items"
          />
          <Link
            href="/admin/menu"
            className="btn btn-ghost btn-sm"
            aria-label="Open full menu management"
          >
            <Icon.Edit size={14} aria-hidden /> Manage menu
          </Link>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => setCollapsed((c) => !c)}
            aria-expanded={!collapsed}
            aria-controls="availability-panel"
          >
            {collapsed ? "Show" : "Hide"}
          </button>
        </div>
      </div>

      {!collapsed && (
        <div
          id="availability-panel"
          className="card overflow-hidden"
        >
          {state === "loading" ? (
            <div className="p-4 text-sm text-ink-500" aria-busy="true">Loading items…</div>
          ) : state === "error" ? (
            <div className="p-4 text-sm text-ink-700">
              {errMsg ?? "Failed to load"}{" "}
              <button type="button" className="btn btn-ghost btn-sm" onClick={reload}>
                <Icon.Refresh size={14} aria-hidden /> Retry
              </button>
            </div>
          ) : filtered.length === 0 ? (
            <div className="p-4 text-sm text-ink-500">No items match.</div>
          ) : (
            <ul className="divide-y" style={{ borderColor: "var(--border-soft)" }}>
              {filtered.map((it) => {
                const edit = editing[it.id];
                const derived = it.isAvailable
                  ? it.stockRemaining > 0
                    ? "available"
                    : "out_of_stock"
                  : "disabled";
                return (
                  <li key={it.id} className="flex items-center gap-3 p-3">
                    <div
                      className="grid h-12 w-16 place-items-center overflow-hidden rounded-md"
                      style={{ background: "var(--cream-200)" }}
                      aria-hidden
                    >
                      {it.imageUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={it.imageUrl} alt="" className="h-full w-full object-cover" />
                      ) : (
                        <Icon.Utensils size={20} />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="truncate text-sm font-semibold text-ink-900">{it.name}</span>
                        <Money minor={it.price} />
                        <StateBadge state={derived} />
                      </div>
                      <div className="mt-0.5 text-xs text-ink-500">
                        {it.stockRemaining > 0
                          ? `${it.stockRemaining} in stock${it.stockRemaining <= it.lowStockThreshold ? " (low)" : ""}`
                          : "No stock left"}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {edit ? (
                        <>
                          <input
                            type="number"
                            inputMode="numeric"
                            min={0}
                            value={edit.value}
                            onChange={(e) => changeEdit(it.id, e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") saveStock(it);
                              if (e.key === "Escape") cancelEdit(it);
                            }}
                            className="input w-20"
                            aria-label={`New stock for ${it.name}`}
                          />
                          <button
                            type="button"
                            className="btn btn-primary btn-sm"
                            onClick={() => saveStock(it)}
                            disabled={edit.saving}
                            aria-busy={edit.saving || undefined}
                          >
                            {edit.saving ? "Saving…" : "Save"}
                          </button>
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm"
                            onClick={() => cancelEdit(it)}
                          >
                            Cancel
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            type="button"
                            className="btn btn-soft btn-sm"
                            onClick={() => startEdit(it)}
                            aria-label={`Set stock for ${it.name}`}
                          >
                            <Icon.Edit size={12} aria-hidden /> Stock
                          </button>
                          <label className="inline-flex cursor-pointer items-center gap-2">
                            <input
                              type="checkbox"
                              className="switch"
                              checked={it.isAvailable}
                              onChange={() => toggleAvailability(it)}
                              aria-label={`Toggle availability for ${it.name}`}
                            />
                          </label>
                        </>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
          {isAdmin ? null : (
            <div className="border-t p-3 text-xs text-ink-500" style={{ borderColor: "var(--border-soft)" }}>
              Need to add, archive, or upload a picture? Open{" "}
              <Link href="/admin/menu" className="link">Manage menu</Link>.
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function StateBadge({ state }: { state: "available" | "out_of_stock" | "disabled" }) {
  if (state === "available") {
    return (
      <span
        className="chip"
        style={{ background: "var(--forest-100, #dcfce7)", color: "var(--forest-700, #047857)" }}
      >
        <Icon.Check size={12} aria-hidden /> Available
      </span>
    );
  }
  if (state === "out_of_stock") {
    return (
      <span
        className="chip"
        style={{ background: "var(--amber-100, #fef3c7)", color: "var(--amber-700, #b45309)" }}
      >
        <Icon.Alert size={12} aria-hidden /> Out of stock
      </span>
    );
  }
  return (
    <span className="chip" style={{ background: "var(--cream-200, #f1f5f9)", color: "var(--ink-700, #334155)" }}>
      <Icon.X size={12} aria-hidden /> Disabled
    </span>
  );
}
