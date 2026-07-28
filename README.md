# Smart Queue Cafeteria MVP

Hackathon MVP that lets students order food from their phone via a counter QR, wait in their seat, and pay cash at pickup — with atomic stock reservation and a fair priority queue for rush hours.

## Stack

- **Next.js 14** (App Router, custom `server.ts` so Socket.IO runs on the same port)
- **PostgreSQL** via Prisma
- **Redis** with custom **Lua scripts** for atomic stock + queue ops
- **Socket.IO** for real-time status updates
- **PWA** (manifest + service worker) so the QR link feels app-like

## Architecture

```
flowchart LR
  StudentPhone[Student Phone] -->|scan QR| Landing["/c/counter-slug"]
  Landing -->|REST| NextAPI[Next.js API]
  NextAPI --> Prisma[(PostgreSQL via Prisma)]
  NextAPI --> Redis[(Redis + Lua scripts)]
  NextAPI -->|emit events| Socket[Socket.IO]
  Socket --> StudentPhone
  Socket --> CashierUI[Cashier POS]
  Socket --> KitchenUI[Kitchen Display]
  CashierUI -->|approve or collect| NextAPI
  KitchenUI -->|start or ready| NextAPI
```

## Run it

```bash
# Prereqs: Node 18+, Postgres 14+, Redis 7+
cp .env.example .env.local

npm install
npx prisma migrate dev --name init
npm run seed     # 2 counters, 16 items, 3 staff
npm run qr       # generate printable QRs in .qr/
npm run dev      # http://localhost:3001 (3000 is occupied by Apache on this machine)
```

Demo logins:

- Cashier: `01700000001 / cashier123`
- Kitchen: `01700000002 / kitchen123`
- Admin:   `01700000099 / admin123`

## Verify

```bash
npm run concurrency   # 50 parallel orders vs 10 stock -> exactly 10 succeed
```

## Key decisions

- **All-or-nothing reservation.** `reserveStock.lua` checks every line first, then decrements. Partial carts never decrement.
- **Anti-starvation.** A cron job every 10s bumps priority scores for orders waiting > 90s, so the kitchen board surfaces stale orders ahead of new bursts.
- **Guest-first ordering.** No signup needed; phone is optional and only captured at checkout.
- **Cash at pickup.** MVP avoids payment-gateway integration; cashier confirms a token to mark `PAID`.

## File map

| Path | Purpose |
|------|---------|
| `server.ts` | Next + Socket.IO + cron promoter |
| `prisma/schema.prisma` | Data model |
| `lib/lua/*.lua` | reserveStock / releaseStock / enqueue / promote |
| `lib/queue.ts` | Typed wrappers around Lua |
| `lib/bus.ts` | Socket emit helpers |
| `app/api/orders/route.ts` | Hot path: reserve + persist + enqueue + emit |
| `app/(student)/c/[slug]` | QR landing menu |
| `app/cashier` | Cashier POS |
| `app/kitchen` | Kitchen ticket board |
| `scripts/seed.ts` | Demo data |
| `scripts/qr.ts` | Printable QR sheets |
| `scripts/concurrency-test.ts` | Atomicity proof |

## License

MIT for the hackathon.