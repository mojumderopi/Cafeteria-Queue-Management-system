"use client";
import { Icon } from "./Icon";
import { Money } from "./Money";

export interface FoodCardItem {
  id: string;
  name: string;
  description?: string | null;
  imageUrl?: string | null;
  price: number; // minor units
  isAvailable: boolean;
  stockRemaining: number;
  lowStockThreshold: number;
}

export function FoodCard({
  item,
  qty,
  onAdd,
  onIncrement,
  onDecrement,
}: {
  item: FoodCardItem;
  qty: number;
  onAdd: () => void;
  onIncrement?: () => void;
  onDecrement?: () => void;
}) {
  const out = !item.isAvailable;
  const low = item.isAvailable && item.stockRemaining <= item.lowStockThreshold;

  return (
    <article
      className="card group flex h-full flex-col overflow-hidden"
      data-unavailable={out || undefined}
    >
      <div
        className="relative aspect-[4/3] w-full overflow-hidden"
        style={{ background: "var(--cream-200)" }}
      >
        {item.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={item.imageUrl}
            alt={item.name}
            loading="lazy"
            className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.02]"
          />
        ) : (
          <div
            className="flex h-full w-full items-center justify-center text-ink-400"
            aria-hidden
          >
            <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M5 4h14l-1.5 4.5A3 3 0 0 1 14.6 11H9.4a3 3 0 0 1-2.9-2.5L5 4Z" />
              <path d="M6 11v3a3 3 0 0 0 3 3h6a3 3 0 0 0 3-3v-3" />
              <path d="M9 17v3M15 17v3" />
            </svg>
          </div>
        )}

        {out ? (
          <span className="absolute left-2 top-2 chip chip-danger">Sold out</span>
        ) : low ? (
          <span className="absolute left-2 top-2 chip chip-warning">
            Only {item.stockRemaining} left
          </span>
        ) : null}
      </div>

      <div className="flex flex-1 flex-col gap-1.5 p-3.5">
        <div className="flex items-start justify-between gap-2">
          <h3 className="text-sm font-semibold text-ink-900 line-clamp-1">{item.name}</h3>
          <Money minor={item.price} className="shrink-0 text-sm font-semibold text-ink-900" />
        </div>
        {item.description ? (
          <p className="line-clamp-2 text-xs leading-relaxed text-ink-500">{item.description}</p>
        ) : (
          <p className="line-clamp-2 text-xs leading-relaxed text-ink-400">
            Freshly prepared at the counter.
          </p>
        )}

        <div className="mt-auto flex items-center justify-end pt-2">
          {out ? (
            <button type="button" className="btn btn-soft btn-sm" disabled aria-disabled>
              Unavailable
            </button>
          ) : qty > 0 ? (
            <div
              className="inline-flex items-center gap-1 rounded-full border border-ink-200 bg-surface p-0.5"
              role="group"
              aria-label={`Quantity for ${item.name}`}
            >
              <button
                type="button"
                onClick={onDecrement}
                className="grid h-7 w-7 place-items-center rounded-full text-ink-700 hover:bg-ink-100"
                aria-label={`Decrease ${item.name}`}
              >
                <Icon.Minus size={14} aria-hidden />
              </button>
              <span className="w-5 text-center text-sm font-semibold text-ink-900 text-mono-num" aria-live="polite">
                {qty}
              </span>
              <button
                type="button"
                onClick={onIncrement}
                className="grid h-7 w-7 place-items-center rounded-full bg-forest-700 text-white hover:bg-forest-800"
                aria-label={`Increase ${item.name}`}
              >
                <Icon.Plus size={14} aria-hidden />
              </button>
            </div>
          ) : (
            <button type="button" onClick={onAdd} className="btn btn-primary btn-sm">
              <Icon.Plus size={14} aria-hidden /> Add
            </button>
          )}
        </div>
      </div>
    </article>
  );
}
