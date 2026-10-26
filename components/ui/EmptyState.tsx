"use client";
import { Icon } from "./Icon";
import type { ReactNode } from "react";

export function EmptyState({
  title,
  description,
  icon = "Info",
  action,
}: {
  title: string;
  description?: string;
  icon?: keyof typeof Icon;
  action?: ReactNode;
}) {
  const I = Icon[icon] as React.ComponentType<{ size?: number; "aria-hidden"?: boolean }>;
  return (
    <div
      role="status"
      className="card flex flex-col items-center justify-center text-center px-6 py-10"
    >
      <div
        className="mb-3 grid h-12 w-12 place-items-center rounded-full"
        style={{ background: "var(--cream-200)", color: "var(--forest-700)" }}
        aria-hidden
      >
        <I size={22} aria-hidden />
      </div>
      <div className="text-base font-semibold text-ink-900">{title}</div>
      {description ? (
        <p className="mt-1 max-w-sm text-sm text-ink-500">{description}</p>
      ) : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}
