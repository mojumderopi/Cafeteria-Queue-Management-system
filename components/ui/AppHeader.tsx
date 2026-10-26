"use client";
import Link from "next/link";
import type { ReactNode } from "react";
import { Icon } from "./Icon";

/**
 * Sticky top app bar with optional back link, title, subtitle and right actions.
 * Uses a glass background so it floats over content.
 */
export function AppHeader({
  title,
  subtitle,
  backHref = "/",
  backLabel = "Home",
  right,
}: {
  title: string;
  subtitle?: string;
  backHref?: string;
  backLabel?: string;
  right?: ReactNode;
}) {
  return (
    <header
      className="sticky top-0 z-30 glass"
      style={{ borderBottom: "1px solid var(--border-soft)" }}
    >
      <div className="app-container flex items-center gap-3 py-3">
        <Link
          href={backHref}
          className="btn btn-ghost btn-sm"
          aria-label={`Back to ${backLabel}`}
        >
          <Icon.ChevronLeft size={16} aria-hidden /> {backLabel}
        </Link>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-base font-semibold text-ink-900 sm:text-lg">{title}</h1>
          {subtitle ? (
            <div className="truncate text-xs text-ink-500">{subtitle}</div>
          ) : null}
        </div>
        {right ? <div className="flex items-center gap-2">{right}</div> : null}
      </div>
    </header>
  );
}
