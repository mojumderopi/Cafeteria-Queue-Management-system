# install.ps1 — one-shot bootstrap for the Smart Queue Cafeteria MVP.
# Run from an *elevated* PowerShell at the project root:
#
#   Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass; .\install.ps1
#
# It will:
#   1. Verify Node 20+ (install via winget if missing).
#   2. Verify PostgreSQL 14+ (install via winget if missing) and start its service.
#   3. Install Redis (Microsoft's port via tporadowski/redis) under C:\Redis and start it.
#   4. Run `npm install` if node_modules is missing.
#   5. Create `.env` from `.env.example` with a freshly-generated SESSION_SECRET.
#   6. Create the `smart_queue` database if it doesn't exist.
#   7. Run `npx prisma migrate dev --name init` if migrations are missing.
#   8. Run `npm run seed` and `npm run qr`.
#   9. Print the URLs the judge should open.

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $root

function Write-Step($msg) { Write-Host "" ; Write-Host "==> $msg" -ForegroundColor Cyan }
function Write-Ok($msg)   { Write-Host "    OK: $msg" -ForegroundColor Green }
function Write-Warn($msg) { Write-Host "    !  $msg" -ForegroundColor Yellow }
function Write-Err($msg)  { Write-Host "    X  $msg" -ForegroundColor Red }

function Assert-Admin {
    $id = [Security.Principal.WindowsIdentity]::GetCurrent()
    $pr = New-Object Security.Principal.WindowsPrincipal($id)
    if (-not $pr.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
        Write-Err "This script must be run from an *elevated* PowerShell."
        Write-Host "    Right-click PowerShell -> 'Run as administrator', then re-run." -ForegroundColor Yellow
        exit 1
    }
}

# Refresh PATH so anything installed by winget in this session is visible.
function Refresh-Path {
    $env:Path = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + `
                [System.Environment]::GetEnvironmentVariable("Path", "User")
}

# --- 0. Admin check ---
Write-Step "Checking administrator privileges"
Assert-Admin
Write-Ok "running as administrator"

# --- 1. Node.js ---
Write-Step "Checking Node.js"
$node = (& node -v 2>&1) | Select-Object -First 1
if ($LASTEXITCODE -ne 0 -or -not $node) {
    Write-Warn "Node.js not found. Installing Node 20 LTS via winget…"
    winget install --id OpenJS.NodeJS.LTS --accept-package-agreements --accept-source-agreements
    if ($LASTEXITCODE -ne 0) { Write-Err "winget install of Node failed"; exit 1 }
    Refresh-Path
    $node = (& node -v) | Select-Object -First 1
}
$nodeVer = [version]($node -replace '^v','')
if ($nodeVer.Major -lt 20) {
    Write-Warn "Node $node found but the project needs Node 20+. Upgrading…"
    winget upgrade --id OpenJS.NodeJS.LTS --accept-package-agreements --accept-source-agreements
    Refresh-Path
    $node = (& node -v) | Select-Object -First 1
}
Write-Ok "Node $node"

# --- 2. PostgreSQL ---
Write-Step "Checking PostgreSQL"
$pgPsql = $null
$candidates = @(
    "C:\Program Files\PostgreSQL\16\bin\psql.exe",
    "C:\Program Files\PostgreSQL\15\bin\psql.exe",
    "C:\Program Files\PostgreSQL\14\bin\psql.exe"
)
foreach ($p in $candidates) { if (Test-Path $p) { $pgPsql = $p; break } }
if (-not $pgPsql) {
    Write-Warn "PostgreSQL not found. Installing via winget…"
    winget install --id PostgreSQL.PostgreSQL.16 --accept-package-agreements --accept-source-agreements
    if ($LASTEXITCODE -ne 0) { Write-Err "winget install of Postgres failed"; exit 1 }
    Refresh-Path
    foreach ($p in $candidates) { if (Test-Path $p) { $pgPsql = $p; break } }
}
if (-not $pgPsql) { Write-Err "could not locate psql.exe after install"; exit 1 }
Write-Ok "psql: $pgPsql"

# Make sure the Postgres service is running.
$pgService = Get-Service | Where-Object { $_.Name -like "postgresql*" -and $_.Name -notlike "*pgbouncer*" } | Select-Object -First 1
if (-not $pgService) {
    Write-Err "PostgreSQL service not found. Try running the install once more."
    exit 1
}
if ($pgService.Status -ne "Running") {
    Write-Host "    starting service $($pgService.Name)…" -ForegroundColor Yellow
    Start-Service -Name $pgService.Name
}
Write-Ok "PostgreSQL service: $($pgService.Name) ($($pgService.Status))"

# --- 3. Redis ---
Write-Step "Checking Redis"
$redisDir = "C:\Redis"
$redisExe = Join-Path $redisDir "redis-server.exe"
$redisRunning = (Get-Process -Name "redis-server" -ErrorAction SilentlyContinue) -ne $null
if (-not (Test-Path $redisExe)) {
    Write-Warn "Redis not found locally. Installing tporadowski/redis to $redisDir…"
    $tmp = Join-Path $env:TEMP "redis-port.zip"
    $url = "https://github.com/tporadowski/redis/releases/download/v5.0.14/Redis-5.0.14-Windows-x64.zip"
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    Invoke-WebRequest -Uri $url -OutFile $tmp -UseBasicParsing
    if ($LASTEXITCODE -ne 0) { Write-Err "Failed to download Redis"; exit 1 }
    New-Item -ItemType Directory -Force -Path $redisDir | Out-Null
    Expand-Archive -Path $tmp -DestinationPath $redisDir -Force
    Remove-Item $tmp -Force
}
if (-not $redisRunning) {
    $conf = Join-Path $redisDir "redis.conf"
    if (-not (Test-Path $conf)) {
        Set-Content -Path $conf -Value @"
bind 127.0.0.1
port 6379
save ""
appendonly no
"@
    }
    Write-Host "    starting redis-server…"
    Start-Process -FilePath $redisExe -ArgumentList "$conf" -WorkingDirectory $redisDir -WindowStyle Hidden
    Start-Sleep -Seconds 1
}
$cliExe = Join-Path $redisDir "redis-cli.exe"
$ping = & $cliExe PING 2>&1
if ($LASTEXITCODE -ne 0) { Write-Err "Redis did not respond to PING: $ping"; exit 1 }
Write-Ok "Redis at $redisDir (PING -> $ping)"

# --- 4. npm install ---
Write-Step "Installing npm dependencies"
if (Test-Path "node_modules\next\package.json") {
    Write-Ok "node_modules already populated — skipping npm install"
} else {
    npm install --no-audit --no-fund
    if ($LASTEXITCODE -ne 0) { Write-Err "npm install failed"; exit 1 }
    Write-Ok "npm install finished"
}

# --- 5. .env ---
Write-Step "Preparing .env"
if (-not (Test-Path ".env") -and (Test-Path ".env.example")) {
    Copy-Item ".env.example" ".env"
    Write-Ok ".env created from .env.example"
}
if (Test-Path ".env") {
    $secretLine = (Select-String -Path ".env" -Pattern '^SESSION_SECRET=' -ErrorAction SilentlyContinue)
    $needsSecret = $true
    if ($secretLine) {
        $val = ($secretLine -split '=',2)[1].Trim().Trim('"')
        if ($val -and $val -ne "change-me-to-32-random-bytes" -and $val.Length -ge 32) {
            $needsSecret = $false
        }
    }
    if ($needsSecret) {
        $secret = (node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
        $envContent = Get-Content ".env" | Where-Object { $_ -notmatch '^SESSION_SECRET=' }
        $envContent += "SESSION_SECRET=`"$secret`""
        Set-Content -Path ".env" -Value $envContent
        Write-Ok "generated fresh SESSION_SECRET (64 hex chars)"
    } else {
        Write-Ok "SESSION_SECRET already set"
    }
} else {
    Write-Warn ".env missing — copy .env.example manually"
}

# --- 6. Database ---
Write-Step "Preparing database smart_queue"
$dbCheck = & $pgPsql -U postgres -h 127.0.0.1 -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='smart_queue'" 2>$null
if ($LASTEXITCODE -ne 0) {
    Write-Warn "psql could not connect without a password. Trying PGPASSWORD from .env…"
    $pgUrl = (Select-String -Path ".env" -Pattern '^DATABASE_URL=' -ErrorAction SilentlyContinue)
    if ($pgUrl) {
        $pw = ([regex]::Match($pgUrl, 'postgres:(?<pw>[^@]+)@')).Groups['pw'].Value
        $env:PGPASSWORD = $pw
        $dbCheck = & $pgPsql -U postgres -h 127.0.0.1 -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='smart_queue'"
        $env:PGPASSWORD = $null
    }
}
if (-not $dbCheck -or $dbCheck.Trim() -ne "1") {
    Write-Host "    creating database smart_queue…"
    $env:PGPASSWORD = $null
    & $pgPsql -U postgres -h 127.0.0.1 -d postgres -c "CREATE DATABASE smart_queue" 2>&1 | Out-Null
}
Write-Ok "smart_queue database ready"

# --- 7. Prisma migrate ---
Write-Step "Running Prisma migration"
$hasMigrations = (Test-Path "prisma\migrations") -and `
    @(Get-ChildItem "prisma\migrations" -Directory -ErrorAction SilentlyContinue | `
       Where-Object { $_.Name -ne "migration_lock.toml" }).Count -gt 0
if ($hasMigrations) {
    Write-Ok "migrations folder already populated — skipping `prisma migrate dev`"
} else {
    npx prisma migrate dev --name init
    if ($LASTEXITCODE -ne 0) { Write-Err "prisma migrate dev failed"; exit 1 }
    Write-Ok "Prisma migration applied"
}

# --- 8. Seed ---
Write-Step "Seeding database + Redis"
npm run seed
if ($LASTEXITCODE -ne 0) { Write-Err "seed failed"; exit 1 }
Write-Ok "Seed complete"

Write-Step "Generating printable QR codes"
npm run qr --silent
if ($LASTEXITCODE -ne 0) { Write-Warn "qr generation failed (non-fatal)" } else { Write-Ok "QR codes in .qr/" }

# --- 9. Done ---
Write-Step "All set!"
$port = 3001
$envPort = (Select-String -Path ".env" -Pattern '^PORT=' -ErrorAction SilentlyContinue)
if ($envPort) { $port = [int](($envPort -split '=',2)[1].Trim()) }
Write-Host "    Start the app with:" -ForegroundColor Green
Write-Host "      npm run dev" -ForegroundColor White
Write-Host "    Then open (port $port):" -ForegroundColor Green
Write-Host "      http://localhost:$port/c/canteen-a     (student QR landing)" -ForegroundColor White
Write-Host "      http://localhost:$port/login           (staff login)" -ForegroundColor White
Write-Host "    Staff logins:" -ForegroundColor Green
Write-Host "      Cashier: 01700000001 / cashier123" -ForegroundColor White
Write-Host "      Kitchen: 01700000002 / kitchen123" -ForegroundColor White
Write-Host "      Admin:   01700000099 / admin123"   -ForegroundColor White