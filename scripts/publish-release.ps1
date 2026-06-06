# Publish v1.0.0 to GitHub (code + Release assets)
# Usage: .\scripts\publish-release.ps1

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot
$version = (Get-Content (Join-Path $repoRoot "package.json") -Raw | ConvertFrom-Json).version
$tag = "v$version"

Push-Location $repoRoot
git remote set-url origin https://github.com/gc0106/agent-status.git

Write-Host "Building v$version ..." -ForegroundColor Cyan
$env:ELECTRON_MIRROR = "https://npmmirror.com/mirrors/electron/"
npm run pack:clean

$portable = Join-Path $repoRoot "release\Agent Status-$version-Portable.exe"
$installer = Join-Path $repoRoot "release\Agent Status-$version-win-x64.exe"
if (-not (Test-Path $portable)) { throw "Missing: $portable" }

Write-Host "Pushing code and tag $tag ..." -ForegroundColor Cyan
git push origin main
git tag -a $tag -m "Agent Status $version stable" -f 2>$null
git push origin $tag -f

Write-Host ""
Write-Host "Code pushed. Upload release assets manually:" -ForegroundColor Yellow
Write-Host "https://github.com/gc0106/agent-status/releases/new?tag=$tag" -ForegroundColor Cyan
Write-Host ""
Write-Host "Upload these files:" -ForegroundColor Gray
Write-Host "  $portable"
Write-Host "  $installer"
Write-Host ""
Write-Host "Or install GitHub CLI and run:" -ForegroundColor Gray
Write-Host "  gh release create $tag `"$portable`" `"$installer`" --title `"Agent Status $version`" --notes-file CHANGELOG.md"

Pop-Location
