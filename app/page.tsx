import Link from "next/link";

export default function HomePage() {
  return (
    <main className="mx-auto max-w-3xl px-5 py-10">
      <header className="flex items-center justify-between">
        <div className="text-xl font-bold text-brand-600">Smart Queue</div>
        <div className="flex gap-2">
          <Link href="/login" className="btn-ghost text-sm">Staff login</Link>
        </div>
      </header>

      <section className="mt-10 rounded-3xl bg-gradient-to-br from-brand-500 to-brand-700 p-8 text-white shadow-lg">
        <h1 className="text-3xl font-bold">Order from your seat. Skip the line.</h1>
        <p className="mt-2 opacity-90">Scan the counter QR, order in 20 seconds, pay cash on pickup.</p>
        <div className="mt-6 grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
          {[
            ["1", "Scan QR"],
            ["2", "Place order"],
            ["3", "Get notified"],
            ["4", "Pay & pick up"],
          ].map(([n, label]) => (
            <div key={n} className="rounded-xl bg-white/10 p-3 backdrop-blur">
              <div className="text-2xl font-bold">{n}</div>
              <div className="opacity-90">{label}</div>
            </div>
          ))}
        </div>
        <p className="mt-6 text-sm opacity-80">Tip: try the live demo counter <code className="rounded bg-black/20 px-1">canteen-a</code>.</p>
        <div className="mt-4 flex gap-2">
          <Link href="/c/canteen-a" className="btn-primary">Open Canteen A</Link>
          <Link href="/c/canteen-b" className="btn-ghost bg-white/20 text-white hover:bg-white/30">Open Canteen B</Link>
        </div>
      </section>

      <section className="mt-8 grid sm:grid-cols-3 gap-3">
        <div className="card">
          <h3 className="font-semibold">Atomic stock</h3>
          <p className="mt-1 text-sm text-stone-600">Redis Lua guarantees no oversell, even when orders pile up at lunch rush.</p>
        </div>
        <div className="card">
          <h3 className="font-semibold">Fair priority queue</h3>
          <p className="mt-1 text-sm text-stone-600">Old orders get auto-promoted so nobody starves waiting.</p>
        </div>
        <div className="card">
          <h3 className="font-semibold">No signup required</h3>
          <p className="mt-1 text-sm text-stone-600">Scan, order, get a token. Save your phone later for faster checkout.</p>
        </div>
      </section>
    </main>
  );
}