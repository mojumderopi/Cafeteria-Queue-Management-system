"use client";
import { useEffect, useState } from "react";

export interface CartLine {
  menuItemId: string;
  name: string;
  unitPrice: number;
  qty: number;
}

const KEY = "cart:v1";

export function useCart() {
  const [lines, setLines] = useState<CartLine[]>([]);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) setLines(JSON.parse(raw));
    } catch {}
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    localStorage.setItem(KEY, JSON.stringify(lines));
  }, [lines, hydrated]);

  function add(item: Omit<CartLine, "qty">, qty = 1) {
    setLines((cur) => {
      const ix = cur.findIndex((l) => l.menuItemId === item.menuItemId);
      if (ix >= 0) {
        const next = [...cur];
        next[ix] = { ...next[ix], qty: Math.min(20, next[ix].qty + qty) };
        return next;
      }
      return [...cur, { ...item, qty }];
    });
  }
  function setQty(menuItemId: string, qty: number) {
    setLines((cur) => cur.map((l) => (l.menuItemId === menuItemId ? { ...l, qty: Math.max(0, Math.min(20, qty)) } : l)).filter((l) => l.qty > 0));
  }
  function clear() {
    setLines([]);
  }
  const total = lines.reduce((s, l) => s + l.unitPrice * l.qty, 0);
  return { lines, add, setQty, clear, total, hydrated };
}