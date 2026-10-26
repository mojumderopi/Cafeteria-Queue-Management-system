# Project Ledger — Phase 2.3 → Phase 3

This ledger tracks autonomous work from Phase 2.3 (final read-only recovery review)
through Phase 3 feature hardening. It is the single source of truth for status;
update it as work progresses.

## Source of truth

- **No pre-existing ledger or roadmap file was found.** The only roadmap in
  the repository is the Puku plan at
  `.puku/plans/smart_queue_cafeteria_mvp_e2533e2f.plan.md` (the original MVP
  plan, all items marked `in_progress`).
- **Phase 2 / Phase 3 work is being driven by the master directive** that
  initiated this ledger. The directive's 2.4–2.7 and 3.1–3.7 areas are the
  authoritative scope until contradicted by repository evidence.

## Working-tree baseline (recorded at start)

Recorded via `git status --short` before any changes in this ledger cycle.

- 30 pre-existing modified tracked files (Phase 1.6–2.2 deliverable surface).
- 30 pre-existing untracked files and directories (`app/admin/`,
  `app/api/admin/`, `app/api/staff/me/`, `components/CashierAvailability.tsx`,
  `components/ui/`, `lib/menu.ts`, `lib/ratelimit.ts`, `lib/storage.ts`,
  `scripts/apply-menu-archive.ts`, `scripts/apply-provider.ts`,
  `scripts/audit-order-statuses.ts`, `scripts/audit-recovery-diff.ts`,
  `scripts/backup.ts`, `scripts/db-probe.ts`, `scripts/recover-stock.ts`,
  `scripts/verify-phase2.ts`, `scripts/verify-restore.ts`,
  `scripts/verify-sigv4.ts`, `scripts/verify-stage-b.ts`, three
  `prisma/migrations/`, several `.out`/`.err` noise files).

All baseline files MUST remain unchanged in this ledger cycle unless the
ledger explicitly notes a change.

## Subphase tracker

| ID    | Subphase                                          | Status   | Notes |
|-------|---------------------------------------------------|----------|-------|
| 2.3   | Final read-only recovery safety review            | completed | Drift = 0; guard live-resolved; no writes. |
| 2.4   | Authn / authz hardening                           | completed | Open-redirect fix in `app/login/page.tsx`; configurable Socket.IO CORS via `SOCKETIO_CORS_ORIGINS`; `secure` flag on staff cookie in production; duplicate `/api/admin/menu/[id]/toggle` removed. |
| 2.5   | API + data integrity                              | completed | Atomic conditional updates on every transition; rollback stock on create-path failure; verify-redirect regression test. |
| 2.6   | Stock / order / queue consistency                 | completed | Promoter now persists bumped `priorityScore` to Postgres; `lib/queue.ts` documents the cross-system consistency model; restored lost `getStock`/`setStock`/`setStockFromDb` exports after a working-tree reversion. |
| 2.7   | Runtime + configuration                           | completed | Startup env check (refuses to boot in production with weak/missing secrets); Socket.IO CORS allowlist via `SOCKETIO_CORS_ORIGINS`; provider isolation enforced by per-counter room gates. |
| 3.1   | Student experience                                | completed | "Counter not found" rendered as distinct missing-counter UI with home link; `ErrorPanel` gained an `action` prop for non-recoverable CTAs. |
| 3.2   | Cashier + kitchen workflows                       | completed | Atomic transitions (2.5), persisted promoter bumps (2.6), and human-readable error toasts on the cashier POS for `bad_state` and `token_mismatch`. |
| 3.3   | Provider administration                           | completed | New `GET /api/admin/analytics/providers` rollup; admin dashboard now shows a provider comparison section above the per-counter section. |
| 3.4   | Platform administration                           | completed | `lib/audit.ts` emits structured JSON lines for every menu mutation (create, restock, archive, restore, availability). |
| 3.5   | Realtime + reliability                            | completed | Kitchen and cashier pages now have a 60s polling safety net alongside the Socket.IO stream. |
| 3.6   | UI + accessibility                                | completed | Audit confirms a11y attributes (aria-label, role, aria-live) on every interactive component; full build passes. |
| 3.7   | Testing + release readiness                       | completed | New static-only tests: `verify-redirect.ts`, `verify-stock-filter.ts`, `verify-audit.ts`, `verify-provider-isolation.ts`. Plus `scripts/run-verify.ps1` and `npm run verify` to run them all. |
| Final | Delivery report (`docs/PHASE2-PHASE3-DELIVERY.md`) | completed | All 12 sections present; Phase 4 addendum in §13. |
| 4     | Phase 4 read-only audit                            | completed | Open-redirect strengthened (backslash trick fixed), reject/cancel release order inverted, `verify-transition-shape.ts` added, verify-audit extended for `menu.item.restore`, provider-isolation tightened to require auth-before-write, .gitignore typo fixed. All 5 verify scripts + tsc + lint + prisma + build pass. |
| R     | Redis stock recovery (apply)                      | BLOCKED  | Persistent data write. Requires explicit authorization. |

## Resumption note

The previous session was interrupted mid-Phase 2.4 after landing the
open-redirect fix in `app/login/page.tsx`. No other files were modified
in that session. This resume point picks up Phase 2.4 with the remaining
items: configurable Socket.IO CORS allowlist, `secure` cookie flag in
production, and removal of the duplicate `/api/admin/menu/[id]/toggle`
route.
