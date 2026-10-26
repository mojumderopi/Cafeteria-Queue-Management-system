"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Icon } from "@/components/ui/Icon";

function LoginForm() {
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [phoneErr, setPhoneErr] = useState<string | null>(null);
  const router = useRouter();
  const params = useSearchParams();
  // Only allow same-origin relative paths to prevent open-redirect
  // abuse. Reject:
  //   - "//evil.com"  : protocol-relative URL
  //   - "/\\evil.com" : backslash trick (some browsers normalize \ to /)
  //   - "\\\\evil.com": UNC-style backslashes
  //   - any leading backslash anywhere on the path
  //   - empty / non-slash starts
  const rawNext = params.get("next") ?? "/cashier";
  const isSafeSameOriginPath =
    rawNext.startsWith("/") &&
    !rawNext.startsWith("//") &&
    !rawNext.includes("\\");
  const next = isSafeSameOriginPath ? rawNext : "/cashier";

  function validate() {
    if (!phone.trim()) {
      setPhoneErr("Please enter your phone number");
      return false;
    }
    if (!password) {
      setErr(null);
      // Use a specific field error
      setErr("Please enter your password");
      return false;
    }
    setPhoneErr(null);
    return true;
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!validate()) return;
    setLoading(true);
    setErr(null);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ phone, password }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (j.error === "invalid_credentials") setErr("Wrong phone or password");
        else if (j.error === "rate_limited") setErr("Too many attempts. Please try again shortly.");
        else setErr("We couldn’t sign you in. Please try again.");
        return;
      }
      const dest = j.role === "KITCHEN" ? "/kitchen" : j.role === "ADMIN" ? "/admin" : next;
      router.push(dest);
    } catch {
      setErr("Network error. Please check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={submit} className="card-lg space-y-4 p-6" noValidate>
      <div className="field">
        <label className="field-label" htmlFor="phone">Phone</label>
        <div className="relative">
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-400" aria-hidden>
            <Icon.Phone size={16} />
          </span>
          <input
            id="phone"
            name="phone"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            className="input pl-9"
            placeholder="e.g. 01700000001"
            value={phone}
            onChange={(e) => {
              setPhone(e.target.value);
              if (phoneErr) setPhoneErr(null);
              if (err) setErr(null);
            }}
            aria-invalid={phoneErr ? true : undefined}
            aria-describedby={phoneErr ? "phone-err" : undefined}
            disabled={loading}
          />
        </div>
        {phoneErr ? (
          <span id="phone-err" className="field-error" role="alert">{phoneErr}</span>
        ) : null}
      </div>

      <div className="field">
        <label className="field-label" htmlFor="password">Password</label>
        <div className="relative">
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-400" aria-hidden>
            <Icon.Cash size={16} />
          </span>
          <input
            id="password"
            name="password"
            type={showPassword ? "text" : "password"}
            autoComplete="current-password"
            className="input pl-9 pr-10"
            placeholder="Enter your password"
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
              if (err) setErr(null);
            }}
            disabled={loading}
          />
          <button
            type="button"
            onClick={() => setShowPassword((s) => !s)}
            className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-ink-500 hover:bg-ink-100"
            aria-label={showPassword ? "Hide password" : "Show password"}
            aria-pressed={showPassword}
            tabIndex={0}
          >
            {showPassword ? <Icon.EyeOff size={16} aria-hidden /> : <Icon.Eye size={16} aria-hidden />}
          </button>
        </div>
      </div>

      {err ? (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-lg p-2.5 text-sm"
          style={{ background: "var(--danger-100)", color: "var(--danger-600)" }}
        >
          <Icon.Alert size={16} aria-hidden /> <span>{err}</span>
        </div>
      ) : null}

      <button type="submit" className="btn btn-primary btn-block btn-lg" disabled={loading} aria-busy={loading || undefined}>
        {loading ? <span className="spinner" aria-hidden /> : null}
        {loading ? "Signing in…" : "Sign in"}
      </button>

      <p className="text-center text-xs text-ink-500">
        Students don&apos;t need an account — just scan the counter&apos;s QR code.
      </p>
    </form>
  );
}

export default function LoginPage() {
  return (
    <div className="page-bg min-h-screen">
      <header
        className="sticky top-0 z-20 glass"
        style={{ borderBottom: "1px solid var(--border-soft)" }}
      >
        <div className="app-container flex items-center justify-between py-3">
          <Link href="/" className="flex items-center gap-2 text-sm font-medium text-ink-700 hover:text-ink-900">
            <Icon.ChevronLeft size={16} aria-hidden /> Home
          </Link>
          <span className="text-xs text-ink-500">Staff only</span>
        </div>
      </header>
      <div className="app-container max-w-md py-10">
        <div>
          <span className="chip chip-forest"><Icon.User size={12} aria-hidden /> Staff</span>
          <h1 className="mt-2 text-display text-ink-900">Sign in to your console</h1>
          <p className="mt-1 text-sm text-ink-500">
            Cashier or kitchen only. Students don&apos;t need an account.
          </p>
        </div>
        <Suspense fallback={<div className="card-lg mt-6 h-72 skeleton rounded-2xl" />}>
          <LoginForm />
        </Suspense>
      </div>
    </div>
  );
}
