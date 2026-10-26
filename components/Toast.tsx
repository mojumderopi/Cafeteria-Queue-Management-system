"use client";
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { Icon } from "./ui/Icon";

export type ToastKind = "info" | "success" | "error";

interface Toast {
  id: string;
  text: string;
  kind: ToastKind;
}

interface Ctx {
  push: (text: string, kind?: ToastKind) => void;
}

const ToastCtx = createContext<Ctx | null>(null);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  const dismiss = useCallback((id: string) => {
    setItems((cur) => cur.filter((t) => t.id !== id));
    if (timers.current[id]) {
      clearTimeout(timers.current[id]);
      delete timers.current[id];
    }
  }, []);

  const push = useCallback(
    (text: string, kind: ToastKind = "info") => {
      const id = Math.random().toString(36).slice(2);
      setItems((cur) => [...cur, { id, text, kind }]);
      timers.current[id] = setTimeout(() => dismiss(id), 4000);
    },
    [dismiss]
  );

  useEffect(() => {
    const t = timers.current;
    return () => {
      Object.values(t).forEach(clearTimeout);
    };
  }, []);

  return (
    <ToastCtx.Provider value={{ push }}>
      {children}
      <div
        className="pointer-events-none fixed inset-x-0 bottom-4 z-[60] flex flex-col items-center gap-2 px-4 pb-safe"
        role="region"
        aria-label="Notifications"
      >
        {items.map((t) => (
          <div
            key={t.id}
            role={t.kind === "error" ? "alert" : "status"}
            className="pointer-events-auto fade-in flex w-full max-w-sm items-start gap-2.5 rounded-xl border px-3.5 py-2.5 text-sm shadow-md"
            style={{
              background: "var(--surface)",
              borderColor:
                t.kind === "error"
                  ? "var(--danger-100)"
                  : t.kind === "success"
                  ? "var(--success-100)"
                  : "var(--border-soft)",
              color: "var(--ink-900)",
            }}
          >
            <span
              className="mt-0.5 grid h-5 w-5 place-items-center rounded-full"
              style={{
                background:
                  t.kind === "error"
                    ? "var(--danger-100)"
                    : t.kind === "success"
                    ? "var(--success-100)"
                    : "var(--info-100)",
                color:
                  t.kind === "error"
                    ? "var(--danger-600)"
                    : t.kind === "success"
                    ? "var(--success-600)"
                    : "var(--info-600)",
              }}
              aria-hidden
            >
              {t.kind === "error" ? (
                <Icon.Alert size={12} aria-hidden />
              ) : t.kind === "success" ? (
                <Icon.Check size={12} aria-hidden />
              ) : (
                <Icon.Info size={12} aria-hidden />
              )}
            </span>
            <span className="flex-1 leading-snug">{t.text}</span>
            <button
              type="button"
              onClick={() => dismiss(t.id)}
              className="ml-1 rounded-md p-1 text-ink-500 hover:bg-ink-100"
              aria-label="Dismiss notification"
            >
              <Icon.X size={14} aria-hidden />
            </button>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export function useToast() {
  const v = useContext(ToastCtx);
  if (!v) throw new Error("ToastProvider missing");
  return v;
}
