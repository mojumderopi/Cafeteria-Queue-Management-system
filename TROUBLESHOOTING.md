# Smart Queue Cafeteria — Run & Debug Guide

This file walks you through running the project from scratch and fixes the
common failure modes you'll hit on Windows. It also documents bugs found in
the initial scaffold and what was changed.

---

## 1. Prerequisites

| Tool | Version | Notes |
| --- | --- | --- |
| Node.js | 20.18+ (see `.nvmrc`) | `node -v` |
| npm | 10+ | ships with Node 20 |
| PostgreSQL | 14+ | running on `localhost:5432` |
| Redis | 6+ | running on `localhost:6379` |
| Git Bash / PowerShell | any | examples use `;` |

Quickest installs on Windows:
- Node.js 20 LTS: `winget install OpenJS.NodeJS.LTS` — restart any open
  terminal afterwards so `node`/`npm` are on `PATH`.
  Verify with `node -v && npm -v`.
- Postgres: `winget install PostgreSQL.PostgreSQL` then add
  `C:\Program Files\PostgreSQL\16\bin` to PATH.
- Redis: `winget install Redis.Redis` (or run in WSL: `sudo apt install redis-server`).
  On Windows the service sometimes fails to bind to `localhost`; if so set
  `REDIS_URL=redis://127.0.0.1:6379` in `.env` (not `localhost`).

Verify all four are reachable:
```bash
node -v                              # v20.x
npm -v                               # 10.x
psql -U postgres -c "SELECT 1"       # Postgres
redis-cli ping                       # Redis (should reply PONG)
```

---

## 2. First-time setup

**Quick path (Windows, recommended):** open an *elevated* PowerShell at the
project root and run the bootstrap script — it checks Node, runs
`npm install`, copies `.env`, applies the Prisma migration, and seeds
the DB:
```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
.\install.ps1
```

**Manual path (or non-Windows):**
```bash
# from project root
copy .env.example .env               # (or `cp` in git-bash)
npm install
```

Edit `.env` and fill in:
```
DATABASE_URL=postgresql://postgres:YOURPASSWORD@localhost:5432/smart_queue
REDIS_URL=redis://127.0.0.1:6379
SESSION_SECRET=replace-me-with-32-random-bytes
PORT=3000
```

Generate a session secret (any 32-char string is fine for the demo):
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Create the Postgres database (one-time):
```bash
psql -U postgres -c "CREATE DATABASE smart_queue;"
```

Run the Prisma migration. **This is the step that creates all the tables** —
the project doesn't auto-create the DB schema for you.
```bash
npx prisma migrate dev --name init
npx prisma generate
```

Seed stock + counters + staff accounts into both Postgres and Redis:
```bash
npm run seed
```
You should see three staff accounts printed:
```
Cashier login: 01700000001 / cashier123
Kitchen login: 01700000002 / kitchen123
Admin login:   01700000099 / admin123
```

Generate QR PNGs for the two counter URLs:
```bash
npm run qr
```

Run the app:
```bash
npm run dev
```
Visit `http://localhost:3000/c/canteen-a` (student flow) and
`http://localhost:3000/cashier` / `/kitchen` after logging in.

---

## 3. Bugs found and fixed during audit

### Bug 1 — `scripts/seed.ts` wiped Redis AFTER setting stock
**Symptom:** After seeding, the menu UI showed `0 in stock` or behaved as if
no items existed. Cashier couldn't approve any order because `reserveStock`
returned `stock_short`.
**Cause:** `redis.flushdb()` was the *last* call in the seed script, deleting
the stock keys we just wrote.
**Fix:** Moved `flushdb()` to run **before** the stock is set, and removed
the trailing one. The Postgres `deleteMany` calls already cleared relational
state; Redis only needs a fresh sweep once at the start.

### Bug 2 — `lib/queue.ts` `setStockFromDb` swallowed pipeline errors
**Symptom:** Seed appeared to succeed but stock was actually missing; no log
indicated failure.
**Cause:** `await pipe.exec()` returns `Array<[Error|null, any]>`; we never
inspected the per-command errors. A Redis hiccup (timeout, OOM) silently
left the DB and Redis out of sync.
**Fix:** Check `results` is non-null and propagate any per-command `Error`.

### Bug 3 — `app/api/orders/[id]/cancel/route.ts` dead auth check
**Symptom:** `getOrCreateGuestId` was called even on staff-only cancel paths,
setting a `guest_id` cookie for users who never ordered. The `if (!allowed)`
block was empty so it didn't actually do anything.
**Cause:** Leftover MVP shortcut — the check never gated the cancel.
**Fix:** Removed the dead block and the now-unused `lib/auth` import.
Anyone holding the order URL can still cancel in PENDING_CASHIER or
APPROVED, matching the original MVP comment.

### Bug 4 — `scripts/seed.ts` referenced undefined password hashes
**Symptom:** `npm run seed` threw `ReferenceError: cashierHash is not defined`.
**Cause:** The `createMany` payload referenced `cashierHash`, `kitchenHash`,
`adminHash` but they were never assigned.
**Fix:** Hash all three passwords with `bcrypt.hash(..., 10)` at the start
of `main()`.

---

## 4. Common failure modes & fixes

### `Error: P1001 — Can't reach database server`
- Postgres isn't running: open `services.msc` and start it.
- Wrong host/port: verify with `psql -U postgres -h localhost -p 5432`.
- Firewall blocking port 5432 (common with corporate Windows laptops).

### `Error: connect ECONNREFUSED 127.0.0.1:6379`
- Redis isn't running: `redis-server` (or start the service).
- On Windows the `Redis` MSI service sometimes binds to `0.0.0.0` only;
  switch `localhost` to `127.0.0.1` in `REDIS_URL`.

### `PrismaClientInitializationError: Environment variable not found: DATABASE_URL`
- `.env` missing or you're running the script from a different cwd.
- `npm run dev` runs from project root, so `.env` at the root is correct.

### `NOSCRIPT No matching script. Please use EVAL.`
- ioredis lost the cached SHA after a Redis restart. The wrapper in
  `lib/queue.ts` re-`SCRIPT LOAD`s on `NOSCRIPT` errors — if you still see
  this, run `redis-cli SCRIPT FLUSH` and restart the dev server.

### Port 3000 already in use
- `netstat -ano | findstr :3000` → `taskkill /PID <pid> /F`.
- Or change `PORT` in `.env` and re-run.

### Cashier/kitchen page redirects back to login
- The `staff` cookie wasn't set. Inspect `/api/auth/login` response — it
  should return `Set-Cookie: staff=...` on a 200.
- Browser blocks third-party cookies: open devtools → Application → Cookies
  and confirm the `staff` cookie exists.

### PWA install banner never shows
- The site must be served over HTTPS or `localhost`. Confirm you're not
  behind a tunnel that strips the manifest link.
- `public/manifest.webmanifest` is served at `/manifest.webmanifest`; if
  you changed basePath, also update `public/sw.js` scope.

### Concurrency test fails: more than N successes on stock=N
- Your Redis is running but Lua scripts are disabled (`rename-command EVAL
  ""`). Re-enable EVAL/SCRIPT in `redis.conf`.

### `Error: ENOENT: no such file or directory, open '.env'`
- Run from project root, not `frontend/` or `backend/` (those are leftover
  empty folders from an earlier scaffold attempt — safe to delete).

---

## 5. Smoke / concurrency tests

After everything is running, sanity-check:
```bash
npm run smoke        # one end-to-end order through the API
npm run concurrency  # 50 parallel POSTs vs stock=10; expect 10 success / 40 stock_short
```

---

## 6. Where to look in logs

- **App logs**: stdout of `npm run dev` — Next + Socket.IO + cron all log here.
- **Prisma queries**: set `DEBUG=prisma:query` in `.env` to see SQL.
- **Lua calls**: `lib/queue.ts` returns `[err, result]` arrays; inspect
  them by running `redis-cli MONITOR` in a separate terminal during the
  concurrency test.

---

## 7. Project layout (after fixes)

```
app/                  # Next.js App Router (UI + API routes)
  api/                # REST endpoints
  c/[slug]/           # student QR landing page
  cashier/            # cashier POS
  kitchen/            # kitchen display
  login/              # staff login
  orders/[id]/        # student live status page
components/           # shared React (MenuClient, Providers, Toast)
hooks/                # useSocket, useCart
lib/                  # prisma, redis, queue (Lua wrappers), auth, bus, promoter, socket-events
lib/lua/              # *.lua source + scripts.ts (SHA cache)
prisma/schema.prisma  # data model
public/               # manifest, sw, icon
scripts/              # seed, qr, smoke, concurrency-test (all tsx-runnable)
server.ts             # custom server: Next + Socket.IO + cron in one process
```

The legacy empty `backend/`, `frontend/`, `DB/` folders from an earlier
scaffold attempt are unused — safe to delete at any time.
