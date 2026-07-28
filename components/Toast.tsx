"use client";
import { createContext, useCallback, useContext, useState, type ReactNode } from "react";

interface Toast { id: string; text: string; kind: "info" | "success" | "error" }
const Ctx = createContext<{ push: (text: string, kind?: Toast["kind"]) => void } | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const push = useCallback((text: string, kind: Toast["kind"] = "info") => {
    const id = Math.random().toString(36).slice(2);
    setItems((cur) => [...cur, { id, text, kind }]);
    setTimeout(() => setItems((cur) => cur.filter((t) => t.id !== id)), 3500);
  }, []);
  return (
    <Ctx.Provider value={{ push }}>
      {children}
      <div className="pointer-events-none fixed bottom-4 inset-x-0 z-50 flex flex-col items-center gap-2">
        {items.map((t) => (
          <div
            key={t.id}
            className={`pointer-events-auto rounded-xl px-4 py-2 shadow-lg text-sm text-white ${
              t.kind === "success" ? "bg-emerald-600" : t.kind === "error" ? "bg-red-600" : "bg-stone-900"
            }`}
          >
            {t.text}
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

export function useToast() {
  const v = useContext(Ctx);
  if (!v) throw new Error("ToastProvider missing");
  return v;
}