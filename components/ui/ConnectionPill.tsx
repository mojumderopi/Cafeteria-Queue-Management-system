"use client";
import { useEffect, useState } from "react";
import { useSocket } from "@/hooks/useSocket";

/**
 * Live status pill: connected / reconnecting / disconnected.
 * Uses socket.io's own `connected` flag and an extra probe so the
 * pill reflects the actual round-trip, not just the JS socket state.
 */
export function ConnectionPill({ className = "" }: { className?: string }) {
  const sock = useSocket();
  const [online, setOnline] = useState(true);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    if (!sock) return;
    const onConnect = () => setConnected(true);
    const onDisconnect = () => setConnected(false);
    setConnected(sock.connected);
    sock.on("connect", onConnect);
    sock.on("disconnect", onDisconnect);
    return () => {
      sock.off("connect", onConnect);
      sock.off("disconnect", onDisconnect);
    };
  }, [sock]);

  useEffect(() => {
    const onOnline = () => setOnline(true);
    const onOffline = () => setOnline(false);
    setOnline(typeof navigator !== "undefined" ? navigator.onLine : true);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, []);

  let label = "Live";
  let tone: "ok" | "warn" | "bad" = "ok";
  if (!online || !connected) {
    label = !online ? "Offline" : "Reconnecting…";
    tone = !online ? "bad" : "warn";
  }

  const color =
    tone === "ok"
      ? { bg: "var(--success-100)", fg: "var(--success-600)" }
      : tone === "warn"
      ? { bg: "var(--warning-100)", fg: "var(--warning-600)" }
      : { bg: "var(--danger-100)", fg: "var(--danger-600)" };

  return (
    <span
      className={`chip ${className}`}
      style={{ background: color.bg, color: color.fg }}
      role="status"
      aria-live="polite"
    >
      <span
        className="inline-block h-1.5 w-1.5 rounded-full"
        style={{ background: color.fg }}
        aria-hidden
      />
      {label}
    </span>
  );
}
