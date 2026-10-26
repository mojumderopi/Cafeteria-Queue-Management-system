$ErrorActionPreference = "Stop"
$env:DATABASE_URL = "postgresql://postgres:smart123@localhost:5432/smart_queue_test?schema=public"
$env:REDIS_URL = "redis://127.0.0.1:6379/15"
$env:SESSION_SECRET = "test-secret-for-integration-test-only"
$env:NODE_ENV = "development"
Write-Host "Using DATABASE_URL=$($env:DATABASE_URL -replace '://[^@]+@', '://***@')"
Write-Host "Using REDIS_URL=$($env:REDIS_URL)"
npx tsx scripts/test-lifecycle-runtime.ts
exit $LASTEXITCODE
