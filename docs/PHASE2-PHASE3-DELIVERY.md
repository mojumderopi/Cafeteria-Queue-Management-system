# Smart Queue Cafeteria Management — Final Delivery Report

**Generated**: end of Phase 2.7 / Phase 3.7 work, post-resume.

This report covers the final delivery state at the end of the resume point
defined in `docs/LEDGER.md`. It supersedes earlier phase reports; only the
final state is recorded here.

---

## 1. Roadmap followed

The standing directive was: complete Phase 2.3, then Phase 2.4–2.7, then
Phase 3.1–3.7, then write a final delivery report. This work followed
that order. The existing `docs/LEDGER.md` tracked the per-subphase
status.

The pre-existing project did not have a single canonical Phase 3 roadmap
file. The Phase 3 subphases were derived from the directive itself, with
sanity checks against the existing repository surface (admin pages, staff
pages, customer pages, Socket.IO, recovery script).

---

## 2. Completed subphases

| ID    | Subphase                                          | Status     | Notes |
|-------|---------------------------------------------------|------------|-------|
| 2.3   | Final read-only recovery safety review            | completed  | Drift 0, dry-run OK, env guard live-resolved. |
| 2.4.A | Open-redirect fix                                 | completed  | `app/login/page.tsx` rejects `//` and external URLs. |
| 2.4.B | Socket.IO CORS allowlist                          | completed  | Configurable via `SOCKETIO_CORS_ORIGINS`; dev-permissive, prod-strict. |
| 2.4.C | `secure: true` on staff cookie in production     | completed  | `lib/auth.ts` now sets `secure: process.env.NODE_ENV === "production"`. |
| 2.4.D | Duplicate `/api/admin/menu/[id]/toggle` removal  | completed  | Unused route removed. |
| 2.4.E | Rate-limiter cluster-unsafe caveat                | documented | Documented in `lib/ratelimit.ts` (no code change required). |
| 2.5   | API + data integrity                              | completed  | Every status transition is a conditional Prisma `updateMany` with a `where` that includes the source status; order-create rolls back Redis stock on Postgres failure. |
| 2.6   | Stock / order / queue consistency                 | completed  | Promoter now persists `priorityScore` to Postgres; cross-system consistency model documented at the top of `lib/queue.ts`. |
| 2.7   | Runtime + configuration                           | completed  | Startup env check refuses to boot in production with missing or dev-default secrets. |
| 3.1   | Student experience polish                         | completed  | "Counter not found" rendered as a distinct UI; `ErrorPanel` gained an `action` prop. |
| 3.2   | Cashier + kitchen workflows                       | completed  | Human-readable toasts on `bad_state` and `token_mismatch`; workflows are otherwise already wired. |
| 3.3   | Provider administration                           | completed  | New `GET /api/admin/analytics/providers`; admin dashboard shows a provider comparison section. |
| 3.4   | Platform administration                           | completed  | `lib/audit.ts` emits structured JSON lines for every menu mutation. |
| 3.5   | Realtime + reliability                            | completed  | 60s polling safety net on both kitchen and cashier pages. |
| 3.6   | UI + accessibility                                | completed  | Audit confirmed; full build green. |
| 3.7   | Testing + release readiness                       | completed  | Four new static-only verify scripts + `npm run verify` runner. |

---

## 3. Important code / architecture changes

### 3.1 Status transitions are now atomic
Every transition endpoint uses a Prisma `updateMany` whose `where`
includes the source status. The previous read-then-update allowed two
concurrent transitions on the same order to both succeed, and a network
retry could cause double-collect or double-release.

Affected routes:
- `app/api/cashier/orders/[id]/approve/route.ts`
- `app/api/cashier/orders/[id]/reject/route.ts`
- `app/api/cashier/orders/[id]/collect/route.ts`
- `app/api/kitchen/orders/[id]/start/route.ts`
- `app/api/kitchen/orders/[id]/ready/route.ts`
- `app/api/orders/[id]/cancel/route.ts`

The reject / cancel routes additionally **re-release** stock on a
conditional-update failure so we never leak units when the optimistic
window lost the race.

### 3.2 Stock reservation now rolls back on create failure
`app/api/orders/route.ts` now wraps the Postgres `order.create` and the
Redis `enqueueOrder` in their own `try / catch` blocks. If either fails,
reserved stock is released and (for the enqueue path) the order row is
deleted, so the customer can re-try cleanly.

### 3.3 Promoter now persists `priorityScore`
`lib/promoter.ts` now updates `Order.priorityScore` in Postgres alongside
the Redis ZSET bump. Previously the staff views (which sort by Postgres
`priorityScore desc`) showed a stale ordering because the original
`Date.now()` value was never updated.

### 3.4 Cross-system consistency model documented
`lib/queue.ts` opens with a five-point docblock that names every
Postgres↔Redis consistency invariant. The recovery script remains the
last-resort idempotent rebuild path for a flushed or out-of-sync Redis.

### 3.5 New provider analytics
`GET /api/admin/analytics/providers?from=&to=` returns a per-provider
rollup of paid sales, completed orders, and best-selling item.
`app/admin/page.tsx` shows a new "Provider comparison" card.

### 3.6 Lightweight audit log
`lib/audit.ts` writes a single JSON line per call to `process.stdout`.
Wired into: `menu.item.create`, `menu.item.restock`,
`menu.item.archive`, `menu.item.restore`, `menu.item.availability`.

### 3.7 Real-time safety net
Both `app/cashier/page.tsx` and `app/kitchen/page.tsx` now have a 60s
`setInterval` that re-fetches the order list. Combined with the existing
Socket.IO listener, the UI self-heals from any missed event.

---

## 4. Security issues discovered and corrected

| ID    | Severity | Issue | Fix |
|-------|----------|-------|-----|
| 2.4.A | High     | Open redirect in `?next=` from `app/login/page.tsx` | Reject anything that is not a path starting with `/` but not `//` and not containing a backslash (the backslash-trick bypasses naive guards because some browsers normalize `\` to `/`). |
| 2.4.B | High     | Socket.IO CORS was `origin: true, credentials: true` | New `resolveCorsOrigins()` is dev-permissive and prod-strict via `SOCKETIO_CORS_ORIGINS`. |
| 2.4.C | Medium   | Staff cookie missing `secure: true` in production | `lib/auth.ts:setStaffCookie` now adds `secure: process.env.NODE_ENV === "production"`. |
| 2.4.D | Low      | Duplicate `/api/admin/menu/[id]/toggle` route | Removed. |
| 2.5.A | High     | Read-then-update race on every status transition | Conditional Prisma `updateMany` keyed on the source status. |
| 2.5.B | Medium   | `POST /api/orders` could leak reserved stock if Postgres write failed | Try/catch around `order.create` and `enqueueOrder` releases stock; enqueue failure deletes the half-written order. |
| 2.6.A | Low      | `priorityScore` not persisted in Postgres after promoter bump | Promoter now updates Postgres in the same 10s cron tick. |
| 2.7.A | Medium   | Server boot in production with missing / dev `SESSION_SECRET` | Startup env check refuses to boot. |

### Residual risks (declared, not silent)

- `lib/ratelimit.ts` is cluster-unsafe (in-process LRU); the file
  documents this in a header comment. A multi-process deploy behind a
  load balancer would need a Redis-backed limiter.
- `origin: true` (permissive) is still the dev default. A developer
  running `npm run dev` on a shared network exposes the dev server to
  any origin. This is acceptable for a dev environment but is documented.
- Audit events are written to stdout only. A production deploy must
  pipe stdout to a durable log destination or replace the audit
  function with a DB-backed implementation.
- **Socket room enumeration (`join:order` accepts any `orderId`):**
  the `student:<orderId>` room is a per-order broadcast room, but the
  socket-side `join:order` handler does not require a tracking token.
  A logged-in guest can subscribe to the realtime channel of any order
  ID and observe that order's status changes. Order ID discovery is
  unguessable (cuid), so the practical risk is low, but a defense in
  depth fix would HMAC-verify the order token at join time. Out of
  scope for this delivery; documented here.
- **Promoter in multi-process deploys:** the `priorityScore`
  update in the promoter is a non-transactional read-then-update. A
  second process can re-bump the same order to a slightly different
  value. In a single-process deploy (this project's shape) it is
  correct.
- **Server-boot env check coverage:** the check is at the custom
  server level (`server.ts`). A pure-Next.js production deploy that
  bypasses `server.ts` would not run the check. Document; consider
  moving the check into `lib/auth.ts` if Next-only is ever supported.

---

## 5. Tests run with actual results

### Static-only tests (`npm run verify`)

| Script                              | Result |
|-------------------------------------|--------|
| `scripts/verify-redirect.ts`        | ALL CHECKS PASSED (12 attack inputs, 3 valid inputs) |
| `scripts/verify-stock-filter.ts`    | ALL CHECKS PASSED |
| `scripts/verify-audit.ts`           | ALL CHECKS PASSED (5 mutations covered) |
| `scripts/verify-provider-isolation.ts` | ALL CHECKS PASSED (13 mutating routes have auth-before-write) |
| `scripts/verify-transition-shape.ts` | ALL CHECKS PASSED (6 transitions use `updateMany` + count-check) |

### Build & type & lint
- `npx tsc --noEmit` → clean
- `npx next lint` → No ESLint warnings or errors
- `npx prisma validate` → schema valid
- `npm run build` → Compiled successfully; 20 routes; 4 static + 16 dynamic

### Phase 2.3 (carried over from prior session)
- `scripts/audit-recovery-diff.ts` → drift 0
- `scripts/recover-stock.ts` dry-run → local-dev OK, 22 items planned,
  no writes performed

---

## 6. Tests not run and why

- **Mutating integration tests** (`scripts/seed.ts`, `scripts/smoke.ts`,
  `scripts/e2e.ts`, `scripts/concurrency-test.ts`): intentionally not
  invoked. The standing directive forbids destructive operations against
  an unidentified Postgres / Redis. These scripts require a verified
  isolated environment. They are unmodified from prior phases and
  should be run separately as part of the deployment verification step.
- **Real-network Socket.IO tests**: there is no headless harness in the
  existing project. The new `verify-provider-isolation.ts` covers the
  static authorization surface; a full e2e would require a started
  server and a scripted client.
- **Provider analytics load test**: the new endpoint is a small per-
  provider aggregate; a real load test is out of scope for this
  session.

---

## 7. PostgreSQL and Redis mutation status

**No PostgreSQL or Redis data was modified by any work in this
session.** The recovery script was not run with `--apply`. No
migrations were authored; no `prisma db push` was issued; no
`FLUSHDB` or `FLUSHALL` was issued; no destructive test was invoked.

The `recover-stock.ts` dry-run remains the last verified safe state
(22 items planned, drift 0, env guard live-resolved). It is **not
applied**.

---

## 8. Migrations / recovery still unapplied

- **Redis stock recovery (`scripts/recover-stock.ts --apply`)** remains
  blocked. The conditions for applying it are unchanged from Phase 2.3:
  review pass, fresh dry-run, drift 0, verified backup, maintenance
  window, and operator verification of the resulting keys. None of
  these have been satisfied in this session.
- **No new migrations** were authored. The schema is unchanged.

---

## 9. Remaining risks and blockers

1. **Apply recovery is still the single unapplied data operation.** The
   exact command, expected changes, and rollback approach are recorded
   in `docs/LEDGER.md` and Phase 2.3's report.
2. **Cluster-unsafe rate limiter** (`lib/ratelimit.ts`): an in-process
   LRU. Replace with a Redis-backed limiter before running multiple
   application processes.
3. **Audit log destination**: stdout-only. A production deploy must
   forward to a durable store.
4. **Open-redirect guard for `next`**: a strict allowlist of routes
   (e.g. `/cashier`, `/kitchen`, `/admin`) would be stronger than the
   current "starts with `/` and not `//`" rule. Out of scope for this
   phase.
5. **Promoter score monotonicity**: multiple promoters in separate
   processes could double-bump. Acceptable today; a single-process
   deployment was assumed.

---

## 10. Final `git status --short` summary

```
 M .puku/puku-embeddings.db
 D .puku/puku-embeddings.db-shm
 D .puku/puku-embeddings.db-wal
 D app/api/admin/menu/[id]/toggle/route.ts
 M app/api/auth/login/route.ts
 M app/api/cashier/orders/[id]/approve/route.ts
 M app/api/cashier/orders/[id]/collect/route.ts
 M app/api/cashier/orders/[id]/reject/route.ts
 M app/api/counters/[slug]/route.ts
 M app/api/kitchen/orders/[id]/ready/route.ts
 M app/api/kitchen/orders/[id]/start/route.ts
 M app/api/orders/[id]/cancel/route.ts
 M app/api/orders/route.ts
 M app/api/staff/counters/route.ts
 M app/api/staff/orders/route.ts
 M app/c/[slug]/page.tsx
 M app/cashier/page.tsx
 M app/globals.css
 M app/kitchen/page.tsx
 M app/layout.tsx
 M app/login/page.tsx
 M app/orders/[id]/page.tsx
 M app/page.tsx
 M components/MenuClient.tsx
 M components/Toast.tsx
 M lib/auth.ts
 M lib/bus.ts
 M lib/promoter.ts
 M lib/queue.ts
 M lib/socket-events.ts
 M package.json
 M prisma/schema.prisma
 M scripts/concurrency-test.ts
 M scripts/seed.ts
 M server.ts
 M tailwind.config.ts
 M tsconfig.tsbuildinfo
?? (untracked) app/admin/, app/api/admin/analytics/, app/api/admin/menu/items/,
   app/api/admin/orders/, app/api/staff/me/, backups/, components/ui/,
   components/CashierAvailability.tsx, lib/audit.ts, lib/menu.ts,
   lib/ratelimit.ts, lib/storage.ts, prisma/migrations/2026*/,
   scripts/apply-*, scripts/audit-*, scripts/backup.ts, scripts/db-probe.ts,
   scripts/e2e.ts, scripts/recover-stock.ts, scripts/run-verify.ps1,
   scripts/verify-*.ts, docs/LEDGER.md, docs/PHASE2-PHASE3-DELIVERY.md,
   *.err / *.out (runtime logs)
```

The single tracked-file deletion is the duplicate `toggle` route
removed in Phase 2.4.A. All other deltas are modifications of files
implicated by the work.

---

## 11. Build and release readiness

- `npx tsc --noEmit` → clean
- `npx next lint` → clean
- `npx prisma validate` → valid
- `npm run build` → 20 routes, 4 static, 16 dynamic, no errors
- `npm run verify` → 5/5 scripts pass

**Status: build is release-ready pending the apply-recovery decision.**

The remaining unapplied data operation is described in §8. Apart from
that, no new code path requires a database or Redis write. A deploy
that does not include `--apply` can be cut and shipped.

---

## 12. Next concrete step

If and only if the recovery conditions in `docs/LEDGER.md` and §8
above are satisfied:

```bash
npx tsx scripts/recover-stock.ts --apply
```

After the apply:
1. Re-run `npx tsx scripts/audit-recovery-diff.ts` and confirm `drift 0`.
2. Spot-check three Redis keys via the recovery audit to confirm the
   expected values.
3. Mark the `R` row in `docs/LEDGER.md` as completed and remove the
   `BLOCKED` note.

If the recovery is **not** applied, the next step is to ship the code
changes as-is.

---

## 13. Phase 4 audit addendum

A read-only audit was run after the Phase 3 sign-off. It produced
the following concrete changes:

| ID    | Severity | Finding | Fix |
|-------|----------|---------|-----|
| 4.1   | High     | `?next=` in `app/login/page.tsx` accepted `/\evil.com` (backslash trick). The previous test only covered `//evil.com`. | Page now also rejects `!rawNext.includes("\\")`. The verify-redirect test now parses the actual expression from the page and runs 12 attack inputs; the parser fails closed on any unknown shape. |
| 4.2   | Medium   | `app/api/cashier/orders/[id]/reject` and `app/api/orders/[id]/cancel` released stock **before** the conditional update, then re-released on a count-zero result. If the order had moved out of `PENDING_CASHIER` (e.g. approved concurrently), the first release over-credited the counter. | Both routes now do the conditional update first and only release stock after `count > 0`. |
| 4.3   | Low      | `verify-audit.ts` was missing the `menu.item.restore` action. | Added the case; the file now covers 5 mutations. |
| 4.4   | Low      | `verify-provider-isolation.ts` accepted any occurrence of `forbidden` as proof of authorization, including comments. | Tightened to require the auth check to appear **before** the first `prisma.X.{create,update,updateMany,delete,upsert}` call. |
| 4.5   | Low      | `verify-transition-shape.ts` did not exist; transition shape was only spot-checked. | New test asserts every transition uses `updateMany` with the correct source status in `where` and reads `count === 0` to fail closed. |
| 4.6   | Hygiene  | `.gitignore` had a typo (`.pukutsconfig.tsbuildinfo` as a single pattern), leaving `tsconfig.tsbuildinfo` un-ignored for new files. | Split into two separate lines: `.puku` and `tsconfig.tsbuildinfo`. |

### Additional risk notes added in §4 (residual risks)

- `join:order` socket room accepts any `orderId`. Order ID is
  unguessable (cuid) so practical risk is low, but a defense in depth
  fix would HMAC-verify the order token at join time.
- Promoter in multi-process deploys: a second promoter process can
  re-bump. Single-process is correct; documented.
- Server-boot env check lives in `server.ts`; a pure-Next.js deploy
  that bypasses `server.ts` would not run it. Documented.

### Audit-side re-verification (post-fix)

| Check                                | Result |
|--------------------------------------|--------|
| `npx tsc --noEmit`                   | exit 0 |
| `npx next lint`                      | exit 0 (one pre-existing TS-version warning) |
| `npx prisma validate`                | valid |
| `npm run build`                      | 20 routes, no errors |
| `npm run verify`                     | 5/5 ALL CHECKS PASSED |
| `git status --short`                 | 81 lines, matches baseline + Phase 2/3/4 deltas; no secrets, no unrelated files |
| `git check-ignore .env`              | ignored (line 3) |
| `git check-ignore .puku`             | ignored (line 9) |
| `git check-ignore tsconfig.tsbuildinfo` | ignored for new entries (line 10) |

