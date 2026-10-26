"use client";
// Full menu management page. Reachable from the cashier "Manage menu" link
// and the admin dashboard. ADMIN sees every counter; CASHIER sees only
// their assigned counters. Soft-delete (archive) is supported; restoring
// re-opens the item without changing its stock.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppHeader } from "@/components/ui/AppHeader";
import { Icon } from "@/components/ui/Icon";
import { Money } from "@/components/ui/Money";
import { ErrorPanel } from "@/components/ui/ErrorPanel";
import { EmptyState } from "@/components/ui/EmptyState";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { useToast } from "@/components/Toast";
import { ConnectionPill } from "@/components/ui/ConnectionPill";

interface ItemRow {
  id: string;
  counterId: string;
  name: string;
  description: string | null;
  price: number;
  isAvailable: boolean;
  stockQty: number;
  stockRemaining: number;
  lowStockThreshold: number;
  imageUrl: string | null;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
}
interface Counter { id: string; name: string; slug: string }
type Role = "CASHIER" | "KITCHEN" | "ADMIN" | null;

export default function MenuManagementPage() {
  const toast = useToast();
  const [role, setRole] = useState<Role>(null);
  const [counters, setCounters] = useState<Counter[]>([]);
  const [counterFilter, setCounterFilter] = useState("");
  const [q, setQ] = useState("");
  const [includeArchived, setIncludeArchived] = useState(false);
  const [items, setItems] = useState<ItemRow[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState<ItemRow | null>(null);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    let alive = true;
    fetch("/api/staff/me")
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => alive && setRole(j?.role ?? null));
    fetch("/api/staff/counters")
      .then((r) => (r.ok ? r.json() : { counters: [] }))
      .then((j) => alive && setCounters(j.counters ?? []));
    return () => {
      alive = false;
    };
  }, []);

  const allowedCounterIds = useMemo(() => {
    if (role === "ADMIN") return null; // all
    return new Set(counters.map((c) => c.id));
  }, [role, counters]);

  const reload = useCallback(async () => {
    if (role !== "ADMIN" && role !== "CASHIER") return;
    setLoading(true);
    setErr(null);
    try {
      const qs = new URLSearchParams();
      if (counterFilter) qs.set("counterId", counterFilter);
      if (q.trim()) qs.set("q", q.trim());
      if (includeArchived) qs.set("includeArchived", "true");
      const res = await fetch(`/api/admin/menu/items?${qs.toString()}`);
      if (!res.ok) {
        setErr(`Failed to load (${res.status})`);
        setItems([]);
        return;
      }
      const data = (await res.json()) as { items: ItemRow[] };
      setItems(data.items);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [role, counterFilter, q, includeArchived]);

  useEffect(() => {
    reload();
  }, [reload]);

  const visible = useMemo(() => {
    if (!items) return null;
    if (allowedCounterIds == null) return items; // admin
    return items.filter((it) => allowedCounterIds.has(it.counterId));
  }, [items, allowedCounterIds]);

  if (role === null) {
    return (
      <div className="page-bg min-h-screen">
        <AppHeader title="Manage menu" backHref="/" backLabel="Home" right={<ConnectionPill />} />
        <div className="app-container py-6">
          <div className="card p-6 text-sm text-ink-700">Checking your access…</div>
        </div>
      </div>
    );
  }
  if (role === "KITCHEN") {
    return (
      <div className="page-bg min-h-screen">
        <AppHeader title="Manage menu" backHref="/" backLabel="Home" right={<ConnectionPill />} />
        <div className="app-container py-6">
          <div className="card p-6 text-sm text-ink-700">
            The kitchen team does not have permission to edit the menu.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="page-bg min-h-screen">
      <AppHeader
        title="Manage menu"
        subtitle={role === "ADMIN" ? "All counters" : counters.map((c) => c.name).join(" · ") || "—"}
        backHref={role === "ADMIN" ? "/admin" : "/cashier"}
        backLabel={role === "ADMIN" ? "Admin" : "Cashier"}
        right={
          <>
            <ConnectionPill className="hidden sm:inline-flex" />
            {role === "ADMIN" ? (
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={() => setCreating(true)}
                disabled={counters.length === 0}
              >
                <Icon.Plus size={14} aria-hidden /> New item
              </button>
            ) : null}
          </>
        }
      />
      <div className="app-container space-y-4 py-4">
        <div className="card flex flex-wrap items-center gap-2 p-3">
          {role === "ADMIN" ? (
            <label className="flex items-center gap-1 text-xs">
              Counter
              <select
                className="select"
                value={counterFilter}
                onChange={(e) => setCounterFilter(e.target.value)}
              >
                <option value="">All</option>
                {counters.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <input
            type="search"
            placeholder="Search items"
            className="input w-44 sm:w-56"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            aria-label="Search items"
          />
          <label className="flex items-center gap-1 text-xs">
            <input
              type="checkbox"
              className="switch"
              checked={includeArchived}
              onChange={(e) => setIncludeArchived(e.target.checked)}
            />
            Show archived
          </label>
          <button type="button" className="btn btn-ghost btn-sm" onClick={reload}>
            <Icon.Refresh size={14} aria-hidden /> Refresh
          </button>
        </div>

        {err ? (
          <ErrorPanel title="Couldn’t load items" description={err} onRetry={reload} />
        ) : visible == null || loading ? (
          <div className="space-y-3" aria-busy="true">
            {[1, 2, 3].map((i) => (
              <div key={i} className="card flex gap-3 p-4">
                <div className="skeleton h-16 w-24" />
                <div className="flex-1 space-y-2">
                  <div className="skeleton h-3 w-1/3" />
                  <div className="skeleton h-3 w-2/3" />
                </div>
              </div>
            ))}
          </div>
        ) : visible.length === 0 ? (
          <EmptyState title="No items" description="Add a new item to get started." />
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {visible.map((it) => (
              <li key={it.id} className="card overflow-hidden">
                <div
                  className="grid h-32 w-full place-items-center"
                  style={{ background: "var(--cream-200)" }}
                  aria-hidden
                >
                  {it.imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={it.imageUrl} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <Icon.Utensils size={32} />
                  )}
                </div>
                <div className="space-y-1 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm font-semibold text-ink-900">{it.name}</span>
                    <span className="text-sm text-ink-700 text-mono-num">
                      <Money minor={it.price} />
                    </span>
                  </div>
                  <div className="line-clamp-2 text-xs text-ink-500">
                    {it.description || "No description."}
                  </div>
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <span className="chip" aria-hidden>
                      {it.stockRemaining} in stock
                    </span>
                    <span className="chip" aria-hidden style={it.archived ? { background: "var(--cream-200)" } : it.isAvailable ? { background: "var(--forest-100, #dcfce7)" } : { background: "var(--amber-100, #fef3c7)" }}>
                      {it.archived ? "Archived" : it.isAvailable ? "Available" : "Disabled"}
                    </span>
                    {role === "ADMIN" ? (
                      <span className="chip" aria-hidden>
                        {counters.find((c) => c.id === it.counterId)?.name ?? it.counterId}
                      </span>
                    ) : null}
                  </div>
                  <div className="flex items-center justify-end gap-1 pt-2">
                    <button
                      type="button"
                      className="btn btn-soft btn-sm"
                      onClick={() => setEditing(it)}
                    >
                      <Icon.Edit size={12} aria-hidden /> Edit
                    </button>
                    {it.archived ? (
                      <button
                        type="button"
                        className="btn btn-soft btn-sm"
                        onClick={() => restore(it)}
                      >
                        <Icon.Refresh size={12} aria-hidden /> Restore
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={() => archive(it)}
                      >
                        <Icon.X size={12} aria-hidden /> Archive
                      </button>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {editing ? (
        <ItemEditor
          item={editing}
          counters={role === "ADMIN" ? counters : counters.filter((c) => allowedCounterIds?.has(c.id))}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            reload();
            toast.push("Saved", "info");
          }}
        />
      ) : null}
      {creating ? (
        <ItemCreator
          counters={counters}
          defaultCounterId={counterFilter || counters[0]?.id || ""}
          onClose={() => setCreating(false)}
          onCreated={() => {
            setCreating(false);
            reload();
            toast.push("Item created", "info");
          }}
        />
      ) : null}
    </div>
  );

  async function archive(it: ItemRow) {
    const res = await fetch(`/api/admin/menu/items/${it.id}/archive`, { method: "POST" });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      toast.push(j.error ?? "Could not archive", "error");
      return;
    }
    toast.push(`${it.name} archived`, "info");
    reload();
  }
  async function restore(it: ItemRow) {
    const res = await fetch(`/api/admin/menu/items/${it.id}/archive`, { method: "DELETE" });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      toast.push(j.error ?? "Could not restore", "error");
      return;
    }
    toast.push(`${it.name} restored`, "info");
    reload();
  }
}

function ItemEditor({
  item,
  counters,
  onClose,
  onSaved,
}: {
  item: ItemRow;
  counters: Counter[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [name, setName] = useState(item.name);
  const [desc, setDesc] = useState(item.description ?? "");
  const [price, setPrice] = useState(String(item.price));
  const [threshold, setThreshold] = useState(String(item.lowStockThreshold));
  const [counterId, setCounterId] = useState(item.counterId);
  const [imageUrl, setImageUrl] = useState<string | null>(item.imageUrl);
  const [uploading, setUploading] = useState(false);
  const [uploadErr, setUploadErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  async function save() {
    const priceN = Number.parseInt(price, 10);
    if (!name.trim()) return toast.push("Name is required", "error");
    if (!Number.isInteger(priceN) || priceN < 0) {
      return toast.push("Price must be a non-negative integer", "error");
    }
    const tN = Number.parseInt(threshold, 10);
    if (!Number.isInteger(tN) || tN < 0) {
      return toast.push("Threshold must be a non-negative integer", "error");
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/menu/items/${item.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          description: desc.trim() || null,
          price: priceN,
          lowStockThreshold: tN,
          counterId,
          imageUrl,
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        toast.push(j.error ?? "Save failed", "error");
        return;
      }
      onSaved();
    } finally {
      setSaving(false);
    }
  }

  async function onPickImage(file: File) {
    setUploading(true);
    setUploadErr(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch(`/api/admin/menu/items/${item.id}/image`, {
        method: "POST",
        body: fd,
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setUploadErr(j.message ?? j.error ?? `Upload failed (${res.status})`);
        return;
      }
      const j = (await res.json()) as { imageUrl: string };
      setImageUrl(j.imageUrl);
      toast.push("Image uploaded", "info");
    } catch (e) {
      setUploadErr((e as Error).message);
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-40 grid place-items-center p-4" role="dialog" aria-modal="true" aria-label="Edit item">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="card relative z-10 w-full max-w-lg space-y-3 p-4">
        <header className="flex items-center justify-between">
          <h3 className="text-base font-semibold text-ink-900">Edit item</h3>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClose} aria-label="Close">
            <Icon.X size={14} aria-hidden />
          </button>
        </header>
        <div>
          <label className="field-label">Name</label>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div>
          <label className="field-label">Description</label>
          <textarea
            className="input min-h-[5rem]"
            value={desc}
            onChange={(e) => setDesc(e.target.value)}
            maxLength={500}
          />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="field-label">Price (minor units)</label>
            <input className="input" type="number" min={0} value={price} onChange={(e) => setPrice(e.target.value)} />
          </div>
          <div>
            <label className="field-label">Low-stock threshold</label>
            <input className="input" type="number" min={0} value={threshold} onChange={(e) => setThreshold(e.target.value)} />
          </div>
        </div>
        <div>
          <label className="field-label">Counter</label>
          <select className="select" value={counterId} onChange={(e) => setCounterId(e.target.value)}>
            {counters.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="field-label">Image</label>
          <div className="flex items-center gap-3">
            <div
              className="grid h-16 w-24 place-items-center overflow-hidden rounded-md"
              style={{ background: "var(--cream-200)" }}
              aria-hidden
            >
              {imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={imageUrl} alt="" className="h-full w-full object-cover" />
              ) : (
                <Icon.Utensils size={20} />
              )}
            </div>
            <input
              ref={fileRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) onPickImage(f);
                if (fileRef.current) fileRef.current.value = "";
              }}
            />
            <button
              type="button"
              className="btn btn-soft btn-sm"
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
              aria-busy={uploading || undefined}
            >
              <Icon.Upload size={14} aria-hidden /> {uploading ? "Uploading…" : imageUrl ? "Replace" : "Upload"}
            </button>
            {imageUrl ? (
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => setImageUrl(null)}
              >
                Remove
              </button>
            ) : null}
          </div>
          {uploadErr ? <p className="mt-1 text-xs text-red-600">{uploadErr}</p> : null}
          <p className="mt-1 text-xs text-ink-500">JPEG, PNG, or WebP up to 5 MB.</p>
        </div>
        <div className="flex items-center justify-end gap-2 pt-2">
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary btn-sm" onClick={save} disabled={saving} aria-busy={saving || undefined}>
            {saving ? "Saving…" : "Save changes"}
          </button>
        </div>
      </div>
    </div>
  );
}

function ItemCreator({
  counters,
  defaultCounterId,
  onClose,
  onCreated,
}: {
  counters: Counter[];
  defaultCounterId: string;
  onClose: () => void;
  onCreated: () => void;
}) {
  const toast = useToast();
  const [counterId, setCounterId] = useState(defaultCounterId);
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [price, setPrice] = useState("0");
  const [stockQty, setStockQty] = useState("0");
  const [isAvailable, setIsAvailable] = useState(true);
  const [saving, setSaving] = useState(false);

  async function create() {
    const priceN = Number.parseInt(price, 10);
    const stockN = Number.parseInt(stockQty, 10);
    if (!counterId) return toast.push("Choose a counter", "error");
    if (!name.trim()) return toast.push("Name is required", "error");
    if (!Number.isInteger(priceN) || priceN < 0) {
      return toast.push("Price must be a non-negative integer", "error");
    }
    if (!Number.isInteger(stockN) || stockN < 0) {
      return toast.push("Stock must be a non-negative integer", "error");
    }
    setSaving(true);
    try {
      const res = await fetch("/api/admin/menu/items", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          counterId,
          name: name.trim(),
          description: desc.trim() || undefined,
          price: priceN,
          stockQty: stockN,
          isAvailable,
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        toast.push(j.error ?? "Create failed", "error");
        return;
      }
      onCreated();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-40 grid place-items-center p-4" role="dialog" aria-modal="true" aria-label="Create item">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="card relative z-10 w-full max-w-lg space-y-3 p-4">
        <header className="flex items-center justify-between">
          <h3 className="text-base font-semibold text-ink-900">New item</h3>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClose} aria-label="Close">
            <Icon.X size={14} aria-hidden />
          </button>
        </header>
        <div>
          <label className="field-label">Counter</label>
          <select className="select" value={counterId} onChange={(e) => setCounterId(e.target.value)}>
            {counters.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="field-label">Name</label>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
        </div>
        <div>
          <label className="field-label">Description</label>
          <textarea className="input min-h-[5rem]" value={desc} onChange={(e) => setDesc(e.target.value)} maxLength={500} />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="field-label">Price (minor)</label>
            <input className="input" type="number" min={0} value={price} onChange={(e) => setPrice(e.target.value)} />
          </div>
          <div>
            <label className="field-label">Initial stock</label>
            <input className="input" type="number" min={0} value={stockQty} onChange={(e) => setStockQty(e.target.value)} />
          </div>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" className="switch" checked={isAvailable} onChange={(e) => setIsAvailable(e.target.checked)} />
          Available for new orders
        </label>
        <div className="flex items-center justify-end gap-2 pt-2">
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary btn-sm" onClick={create} disabled={saving} aria-busy={saving || undefined}>
            {saving ? "Creating…" : "Create"}
          </button>
        </div>
      </div>
    </div>
  );
}
