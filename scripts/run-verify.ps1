$ErrorActionPreference = "Stop"
$tests = @(
  "verify-redirect.ts",
  "verify-stock-filter.ts",
  "verify-audit.ts",
  "verify-provider-isolation.ts",
  "verify-transition-shape.ts",
  "verify-order-auth.ts"
)
$failed = 0
foreach ($f in $tests) {
  Write-Host ""
  Write-Host "=== $f ==="
  npx tsx "scripts\$f"
  if ($LASTEXITCODE -ne 0) {
    Write-Host "FAIL  $f"
    $failed += 1
  }
}
if ($failed -gt 0) {
  Write-Host ""
  Write-Host "$failed verify script(s) failed"
  exit 1
}
Write-Host ""
Write-Host "All verify scripts passed"
