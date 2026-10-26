"use client";
import type { ReactNode } from "react";
import { Icon } from "./Icon";

export function ErrorPanel({
  title = "Something went wrong",
  description = "We couldn’t load this. Please check your connection and try again.",
  onRetry,
  retryLabel = "Try again",
  action,
}: {
  title?: string;
  description?: string;
  onRetry?: () => void;
  retryLabel?: string;
  // Optional CTA shown in place of (or alongside) the retry button.
  // Use this for non-recoverable states like "counter not found".
  action?: ReactNode;
}) {
  return (
    <div
      role="alert"
      className="card flex flex-col items-center text-center px-6 py-8"
      style={{ borderColor: "var(--danger-100)" }}
    >
      <div
        className="mb-3 grid h-12 w-12 place-items-center rounded-full"
        style={{ background: "var(--danger-100)", color: "var(--danger-600)" }}
        aria-hidden
      >
        <Icon.Alert size={22} aria-hidden />
      </div>
      <div className="text-base font-semibold text-ink-900">{title}</div>
      <p className="mt-1 max-w-sm text-sm text-ink-500">{description}</p>
      <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
        {action}
        {onRetry ? (
          <button
            type="button"
            onClick={onRetry}
            className="btn btn-ghost"
          >
            <Icon.Refresh size={16} aria-hidden /> {retryLabel}
          </button>
        ) : null}
      </div>
    </div>
  );
}
