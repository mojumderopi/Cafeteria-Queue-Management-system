"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

function LoginForm() {
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next") ?? "/cashier";

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setErr(null);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ phone, password }),
      });
      const j = await res.json();
      if (!res.ok) {
        setErr(j.error === "invalid_credentials" ? "Wrong phone or password" : "Login failed");
        return;
      }
      // Send cashier to dashboard, kitchen to board, admin to admin.
      const dest = j.role === "KITCHEN" ? "/kitchen" : j.role === "ADMIN" ? "/admin" : next;
      router.push(dest);
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={submit} className="card mt-6 space-y-3">
      <input
        className="w-full rounded-xl border border-stone-300 px-3 py-2"
        placeholder="Phone"
        value={phone}
        onChange={(e) => setPhone(e.target.value)}
      />
      <input
        className="w-full rounded-xl border border-stone-300 px-3 py-2"
        placeholder="Password"
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
      />
      {err && <div className="text-sm text-red-600">{err}</div>}
      <button className="btn-primary w-full" disabled={loading}>
        {loading ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}

export default function LoginPage() {
  return (
    <main className="mx-auto max-w-md px-4 py-10">
      <h1 className="text-2xl font-bold">Staff login</h1>
      <p className="mt-1 text-sm text-stone-600">Cashier or kitchen only. Students don&apos;t need an account.</p>
      <Suspense fallback={<div className="card mt-6 h-40 animate-pulse" />}>
        <LoginForm />
      </Suspense>
    </main>
  );
}