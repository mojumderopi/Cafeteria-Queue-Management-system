"use client";
import { useEffect, useRef } from "react";
import { Icon } from "./Icon";

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  destructive = false,
  loading = false,
  onConfirm,
  onCancel,
  children,
}: {
  open: boolean;
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  children?: React.ReactNode;
}) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  // Tracks the open → closed transition so we only install/remove the
  // Escape handler and move focus to the cancel button once, when the
  // dialog *opens*. Earlier versions of this effect re-ran whenever
  // `onCancel` changed (which it does on every parent render when passed
  // inline), causing the cancel button to steal focus from the dialog's
  // text inputs on every keystroke.
  const prevOpenRef = useRef(false);

  useEffect(() => {
    if (open === prevOpenRef.current) return;
    prevOpenRef.current = open;
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !loading) onCancel();
    };
    document.addEventListener("keydown", onKey);
    // Focus the cancel button by default for safety.
    cancelRef.current?.focus();
    return () => document.removeEventListener("keydown", onKey);
    // `onCancel` and `loading` are intentionally read on each transition so
    // the Escape handler always sees the latest version.
  }, [open, loading, onCancel]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center p-4 sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-dialog-title"
    >
      <div
        className="absolute inset-0 bg-ink-900/40 backdrop-blur-sm"
        onClick={() => !loading && onCancel()}
        aria-hidden
      />
      <div className="glass-strong relative w-full max-w-md rounded-2xl p-5 shadow-lg">
        <div className="flex items-start gap-3">
          <div
            className="grid h-9 w-9 place-items-center rounded-full"
            style={{
              background: destructive ? "var(--danger-100)" : "var(--amber-100)",
              color: destructive ? "var(--danger-600)" : "var(--amber-700)",
            }}
            aria-hidden
          >
            {destructive ? <Icon.Alert size={18} /> : <Icon.Info size={18} />}
          </div>
          <div className="flex-1">
            <h3 id="confirm-dialog-title" className="text-base font-semibold text-ink-900">
              {title}
            </h3>
            {description ? (
              <p className="mt-1 text-sm text-ink-500">{description}</p>
            ) : null}
            {children ? <div className="mt-3">{children}</div> : null}
          </div>
        </div>
        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button
            ref={cancelRef}
            type="button"
            className="btn btn-ghost"
            onClick={onCancel}
            disabled={loading}
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            className={destructive ? "btn btn-danger" : "btn btn-primary"}
            onClick={onConfirm}
            disabled={loading}
            aria-busy={loading || undefined}
          >
            {loading ? <span className="spinner" aria-hidden /> : null}
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
