# install.ps1 — one-shot bootstrap for the Smart Queue Cafeteria MVP.
# Run from an *elevated* PowerShell at the project root:
#
#   Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass; .\install.ps1
#
# It will:
#   1. Check that Node.js 20+ is installed (and tell you how to get it if not).
#   2. Run `npm install` if node_modules is missing.
#   3. Copy .env.example -> .env if .env doesn't exist.
#   4. Run `npx prisma migrate dev --name init` if migrations are missing.
#   5. Run `npm run seed`.
#   6. Tell you how to start the app.

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $root

function Write-Step($msg) { Write-Host "`n==> $msg" -ForegroundColor Cyan }
function Write-Ok($msg)   { Write-Host "    OK: $msg" -ForegroundColor Green }
function Write-Warn($msg) { Write-Host "    !  $msg" -ForegroundColor Yellow }
function Write-Err($msg)  { Write-Host "    X  $msg" -ForegroundColor Red }

# --- 1. Node.js check ---
Write-Step "Checking Node.js"
$node = (& node -v 2>&1) | Select-Object -First 1
if ($LASTEXITCODE -ne 0) {
  Write-Err "Node.js is not installed."
  Write-Host "    Install Node 20 LTS with one of:" -ForegroundColor Yellow
  Write-Host "      winget install OpenJS.NodeJS.LTS"
  Write-Host "      https://nodejs.org/en/download  (Windows Installer .msi)"
  Write-Host "    Then open a NEW terminal and re-run this script."
  exit 1
}
$nodeVer = [version]($node -replace '^v','')
if ($nodeVer.Major -lt 20) {
  Write-Err "Node $node found but this project needs Node 20+."
  Write-Host "    Update with: winget upgrade OpenJS.NodeJS.LTS" -ForegroundColor Yellow
  exit 1
}
Write-Ok "Node $node"

# --- 2. npm install ---
Write-Step "Installing dependencies"
if (Test-Path "node_modules\next\package.json") {
  Write-Ok "node_modules already populated — skipping npm install"
} else {
  npm install --no-audit --no-fund
  if ($LASTEXITCODE -ne 0) { Write-Err "npm install failed"; exit 1 }
  Write-Ok "npm install finished"
}

# --- 3. .env ---
Write-Step "Preparing .env"
if (Test-Path ".env") {
  Write-Ok ".env already exists"
} elseif (Test-Path ".env.example") {
  Copy-Item ".env.example" ".env"
  Write-Ok ".env created from .env.example — open it and fill in DATABASE_URL/REDIS_URL/SESSION_SECRET"
} else {
  Write-Warn ".env.example missing; skipping"
}

# --- 4. Prisma migration ---
Write-Step "Running Prisma migration"
$hasMigrations = (Test-Path "prisma\migrations") -and `
  @(Get-ChildItem "prisma\migrations" -Directory -ErrorAction SilentlyContinue | `
     Where-Object { $_.Name -ne "migration_lock.toml" }).Count -gt 0
if ($hasMigrations) {
  Write-Ok "migrations folder already populated — skipping `prisma migrate dev`"
} else {
  if (-not (Test-Path ".env")) {
    Write-Err "Cannot run Prisma without .env (need DATABASE_URL). Create .env first."
    exit 1
  }
  npx prisma migrate dev --name init
  if ($LASTEXITCODE -ne 0) { Write-Err "prisma migrate dev failed"; exit 1 }
  Write-Ok "Prisma migration applied"
}

# --- 5. Seed ---
Write-Step "Seeding database + Redis"
npm run seed
if ($LASTEXITCODE -ne 0) { Write-Err "seed failed"; exit 1 }
Write-Ok "Seed complete"

# --- 6. Done ---
Write-Step "All set!"
Write-Host "    Start the app with:" -ForegroundColor Green
Write-Host "      npm run dev" -ForegroundColor White
Write-Host "    Then open:" -ForegroundColor Green
Write-Host "      http://localhost:3000/c/canteen-a     (student QR landing)" -ForegroundColor White
Write-Host "      http://localhost:3000/login           (staff login)" -ForegroundColor White
Write-Host "    Staff logins:" -ForegroundColor Green
Write-Host "      Cashier: 01700000001 / cashier123" -ForegroundColor White
Write-Host "      Kitchen: 01700000002 / kitchen123" -ForegroundColor White
Write-Host "      Admin:   01700000099 / admin123"   -ForegroundColor White