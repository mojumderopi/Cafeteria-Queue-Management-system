// Audit log for administrative mutations. Emits a single structured
// JSON line to stdout so operators can pipe to a log aggregator. This is
// intentionally lightweight: no DB writes, no schema changes, no
// dependency on a third-party service.
//
// We log the staff identity, the action, the target, and a timestamp.
// Never log secrets, full order contents, or the customer's phone
// number beyond a redacted form.

export type AuditEvent = {
  // ISO timestamp (ms precision).
  ts: string;
  // The staff identity performing the action.
  actor: { sub: string; role: string; name?: string | null };
  // The action verb, e.g. "menu.item.create", "menu.item.archive".
  action: string;
  // The primary target, e.g. a menuItemId or counterId.
  target: string;
  // Optional structured details. Keep small. NEVER include
  // passwords, tokens, or PII like the customer's full phone.
  details?: Record<string, unknown>;
};

export function audit(ev: Omit<AuditEvent, "ts">): void {
  const line: AuditEvent = { ts: new Date().toISOString(), ...ev };
  // Use process.stdout to keep it on a single line; the log aggregator
  // is responsible for parsing. No pretty printing.
  process.stdout.write(JSON.stringify({ kind: "audit", ...line }) + "\n");
}
