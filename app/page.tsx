"use client";

import Link from "next/link";
import { Icon } from "@/components/ui/Icon";

export default function HomePage() {
  return (
    <div>
      <header className="sticky top-0 z-20 glass" style={{ borderBottom: "1px solid var(--border-soft)" }}>
        <div className="app-container flex items-center justify-between py-3">
          <Link href="/" className="flex items-center gap-2">
            <span
              className="grid h-8 w-8 place-items-center rounded-lg"
              style={{ background: "var(--forest-700)", color: "white" }}
              aria-hidden
            >
              <Icon.Store size={18} />
            </span>
            <span className="text-base font-semibold tracking-tight text-ink-900">Smart Queue</span>
            <span className="chip chip-forest">Cafeteria</span>
          </Link>
          <nav className="flex items-center gap-2" aria-label="Primary">
            <Link href="/login" className="btn btn-ghost btn-sm">
              <Icon.User size={14} aria-hidden /> Staff login
            </Link>
          </nav>
        </div>
      </header>

      <section className="app-container pt-10 sm:pt-14">
        <div className="grid items-center gap-8 lg:grid-cols-[1.2fr_1fr]">
          <div>
            <span className="chip chip-forest">
              <Icon.Sparkle size={12} aria-hidden /> Premium food ordering
            </span>
            <h1 className="mt-3 text-display text-ink-900">
              Order from your seat. <br className="hidden sm:block" />
              <span style={{ color: "var(--forest-700)" }}>Skip the line.</span>
            </h1>
            <p className="mt-3 max-w-xl text-base leading-relaxed text-ink-500">
              Scan your counter&apos;s QR code, build your order in under a minute, and pay cash on pickup.
              Real-time queue, no signup, no overselling.
            </p>
            <div className="mt-6 flex flex-wrap gap-2">
              <Link href="/c/canteen-a" className="btn btn-primary btn-lg">
                Open Canteen A <Icon.ArrowRight size={16} aria-hidden />
              </Link>
              <Link href="/c/canteen-b" className="btn btn-ghost btn-lg">
                Open Canteen B
              </Link>
            </div>
            <p className="mt-3 text-xs text-ink-500">
              Tip: try the live demo counter <code className="rounded bg-cream-200 px-1.5 py-0.5">canteen-a</code>.
            </p>
          </div>

          <div className="card-lg relative overflow-hidden p-6">
            <div
              className="absolute -right-10 -top-10 h-40 w-40 rounded-full"
              style={{ background: "var(--amber-100)", filter: "blur(40px)" }}
              aria-hidden
            />
            <div
              className="absolute -bottom-12 -left-10 h-40 w-40 rounded-full"
              style={{ background: "var(--forest-100)", filter: "blur(40px)" }}
              aria-hidden
            />
            <div className="relative">
              <div className="section-title">How it works</div>
              <ol className="mt-3 space-y-3">
                {[
                  { n: 1, t: "Scan QR", d: "Each counter has its own QR code that opens the menu." },
                  { n: 2, t: "Place order", d: "Add items to the cart and confirm. Stock is reserved instantly." },
                  { n: 3, t: "Get notified", d: "Receive a token and watch your order move through the queue." },
                  { n: 4, t: "Pay & pick up", d: "Pay cash on pickup when your token is called." },
                ].map((s) => (
                  <li key={s.n} className="flex items-start gap-3">
                    <span
                      className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-xs font-bold text-white"
                      style={{ background: "var(--forest-700)" }}
                      aria-hidden
                    >
                      {s.n}
                    </span>
                    <div>
                      <div className="text-sm font-semibold text-ink-900">{s.t}</div>
                      <div className="text-xs text-ink-500">{s.d}</div>
                    </div>
                  </li>
                ))}
              </ol>
            </div>
          </div>
        </div>
      </section>

      <section className="app-container mt-12 grid gap-3 sm:grid-cols-3">
        {[
          {
            t: "Atomic stock",
            d: "Redis Lua guarantees no oversell, even when orders pile up at lunch rush.",
            icon: "Cash" as const,
          },
          {
            t: "Fair priority queue",
            d: "Old orders get auto-promoted so nobody starves waiting.",
            icon: "Clock" as const,
          },
          {
            t: "No signup required",
            d: "Scan, order, get a token. Save your phone later for faster checkout.",
            icon: "QrCode" as const,
          },
        ].map((f) => {
          const I = Icon[f.icon];
          return (
            <div key={f.t} className="card flex flex-col gap-2 p-4">
              <span
                className="grid h-9 w-9 place-items-center rounded-lg"
                style={{ background: "var(--forest-100)", color: "var(--forest-800)" }}
                aria-hidden
              >
                <I size={18} aria-hidden />
              </span>
              <div className="text-sm font-semibold text-ink-900">{f.t}</div>
              <p className="text-sm text-ink-500">{f.d}</p>
            </div>
          );
        })}
      </section>

      <footer className="app-container mt-12 pb-10 text-center text-xs text-ink-500">
        Smart Queue Cafeteria · Operational dashboards for cashiers &amp; kitchen.
      </footer>
    </div>
  );
}
