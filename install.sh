#!/usr/bin/env bash
# install.sh — one-shot bootstrap for the Smart Queue Cafeteria MVP.
# Tested on Ubuntu 22.04+ / macOS with Homebrew.
#
# Run from the project root:
#   bash install.sh
#
# It will:
#   1. Verify Node 20+ (install via nvm/n if missing).
#   2. Install PostgreSQL (apt / brew) and start it.
#   3. Install Redis (apt / brew) and start it.
#   4. npm install if node_modules is missing.
#   5. Create `.env` from `.env.example` with a freshly-generated SESSION_SECRET.
#   6. Create the `smart_queue` database.
#   7. Run `npx prisma migrate dev --name init` if migrations are missing.
#   8. Run `npm run seed` and `npm run qr`.
#   9. Print the URLs the judge should open.

set -euo pipefail
cd "$(dirname "$0")"

BOLD=$'\e[1m'
CYAN=$'\e[36m'
GREEN=$'\e[32m'
YELLOW=$'\e[33m'
RED=$'\e[31m'
RESET=$'\e[0m'

step() { printf "\n${CYAN}==> %s${RESET}\n" "$1"; }
ok()   { printf "    ${GREEN}OK:${RESET} %s\n" "$1"; }
warn() { printf "    ${YELLOW}!${RESET}  %s\n" "$1"; }
err()  { printf "    ${RED}X${RESET}  %s\n" "$1"; }

# --- 1. Node.js ---
step "Checking Node.js"
if ! command -v node >/dev/null 2>&1; then
  warn "Node.js not found. Trying apt…"
  if command -v apt-get >/dev/null 2>&1; then
    curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
    sudo apt-get install -y nodejs
  elif command -v brew >/dev/null 2>&1; then
    brew install node@20
    brew link --force --overwrite node@20
  else
    err "Install Node 20 LTS manually: https://nodejs.org"
    exit 1
  fi
fi
NODE_VER=$(node -v)
NODE_MAJOR=$(printf '%s' "$NODE_VER" | sed 's/^v//' | cut -d. -f1)
if [ "$NODE_MAJOR" -lt 20 ]; then
  warn "Node $NODE_VER found but project needs Node 20+. Aborting."
  exit 1
fi
ok "Node $NODE_VER"

# --- 2. PostgreSQL ---
step "Checking PostgreSQL"
if ! command -v psql >/dev/null 2>&1; then
  warn "PostgreSQL not found. Installing…"
  if command -v apt-get >/dev/null 2>&1; then
    sudo apt-get update
    sudo apt-get install -y postgresql postgresql-contrib
    sudo service postgresql start || true
  elif command -v brew >/dev/null 2>&1; then
    brew install postgresql@16
    brew services start postgresql@16 || true
  else
    err "Install Postgres 14+ manually."
    exit 1
  fi
fi
# Make sure it's running.
if command -v systemctl >/dev/null 2>&1; then
  sudo systemctl start postgresql 2>/dev/null || true
fi
ok "PostgreSQL available"

# --- 3. Redis ---
step "Checking Redis"
if ! command -v redis-server >/dev/null 2>&1; then
  warn "Redis not found. Installing…"
  if command -v apt-get >/dev/null 2>&1; then
    sudo apt-get install -y redis-server
    sudo service redis-server start || true
  elif command -v brew >/dev/null 2>&1; then
    brew install redis
    brew services start redis || true
  else
    err "Install Redis manually: https://redis.io/download"
    exit 1
  fi
fi
if ! pgrep -x redis-server >/dev/null 2>&1; then
  redis-server --daemonize yes --port 6379
fi
sleep 1
PONG=$(redis-cli PING 2>/dev/null || echo "DOWN")
if [ "$PONG" != "PONG" ]; then
  err "Redis is not responding to PING."
  exit 1
fi
ok "Redis (PING -> PONG)"

# --- 4. npm install ---
step "Installing npm dependencies"
if [ -d node_modules ] && [ -f node_modules/next/package.json ]; then
  ok "node_modules already populated — skipping"
else
  npm install --no-audit --no-fund
fi

# --- 5. .env ---
step "Preparing .env"
if [ ! -f .env ] && [ -f .env.example ]; then
  cp .env.example .env
  ok ".env created from .env.example"
fi
if [ -f .env ]; then
  current=$(grep '^SESSION_SECRET=' .env | head -1 | cut -d= -f2- | sed 's/^"//;s/"$//')
  if [ -z "$current" ] || [ "$current" = "change-me-to-32-random-bytes" ] || [ "${#current}" -lt 32 ]; then
    secret=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
    sed -i.bak "/^SESSION_SECRET=/d" .env || true
    echo "SESSION_SECRET=\"$secret\"" >> .env
    rm -f .env.bak
    ok "generated fresh SESSION_SECRET"
  else
    ok "SESSION_SECRET already set"
  fi
fi

# --- 6. Database ---
step "Preparing database smart_queue"
if ! command -v psql >/dev/null 2>&1; then
  err "psql missing even after install"
  exit 1
fi
# Try a peer-trusted connection first (the Ubuntu default), then fall back to the
# password in DATABASE_URL when present.
DB_URL=$(grep '^DATABASE_URL=' .env | head -1 | cut -d= -f2- | sed 's/^"//;s/"$//')
PGUSER=$(printf '%s' "$DB_URL" | sed -E 's|.*://([^:]+):.*|\1|')
PGPASSWORD_FROM_URL=$(printf '%s' "$DB_URL" | sed -E 's|.*://[^:]+:([^@]+)@.*|\1|')

EXISTS=$(sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='smart_queue'" 2>/dev/null || \
        PGPASSWORD="$PGPASSWORD_FROM_URL" psql -U "$PGUSER" -h localhost -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='smart_queue'" 2>/dev/null || echo "")
if [ "$EXISTS" != "1" ]; then
  warn "creating database smart_queue…"
  sudo -u postgres psql -c "CREATE DATABASE smart_queue" 2>/dev/null || \
  PGPASSWORD="$PGPASSWORD_FROM_URL" psql -U "$PGUSER" -h localhost -d postgres -c "CREATE DATABASE smart_queue" 2>/dev/null
fi
ok "smart_queue database ready"

# --- 7. Prisma migrate ---
step "Running Prisma migration"
if [ -d prisma/migrations ] && [ "$(ls -1 prisma/migrations 2>/dev/null | grep -v migration_lock.toml | wc -l)" -gt 0 ]; then
  ok "migrations folder already populated — skipping"
else
  npx prisma migrate dev --name init
fi

# --- 8. Seed ---
step "Seeding database + Redis"
npm run seed

step "Generating printable QR codes"
npm run qr --silent || warn "qr generation failed (non-fatal)"

# --- 9. Done ---
step "All set!"
PORT=$(grep '^PORT=' .env | head -1 | cut -d= -f2- | sed 's/^"//;s/"$//')
PORT=${PORT:-3001}
printf "${GREEN}    Start the app with:${RESET}\n"
printf "${BOLD}      npm run dev${RESET}\n"
printf "${GREEN}    Then open (port $PORT):${RESET}\n"
printf "${BOLD}      http://localhost:$PORT/c/canteen-a${RESET}  (student QR landing)\n"
printf "${BOLD}      http://localhost:$PORT/login${RESET}        (staff login)\n"
printf "${GREEN}    Staff logins:${RESET}\n"
printf "      Cashier: 01700000001 / cashier123\n"
printf "      Kitchen: 01700000002 / kitchen123\n"
printf "      Admin:   01700000099 / admin123\n"
