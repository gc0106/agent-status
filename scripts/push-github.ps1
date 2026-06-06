# One-time: add SSH public key to GitHub, then push.
# Run in PowerShell: .\scripts\push-github.ps1

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot
$keyPath = Join-Path $env:USERPROFILE ".ssh\id_ed25519"
$pubPath = "$keyPath.pub"

if (-not (Test-Path $pubPath)) {
  ssh-keygen -t ed25519 -f $keyPath -N '""' -C "812588365@qq.com"
}

$pub = Get-Content $pubPath -Raw
Set-Clipboard -Value $pub.Trim()

Write-Host ""
Write-Host "公钥已复制到剪贴板。请在浏览器中打开 GitHub 添加 SSH Key：" -ForegroundColor Cyan
Write-Host "https://github.com/settings/ssh/new" -ForegroundColor Yellow
Write-Host ""
Write-Host "Title 填: agent-status-pc" -ForegroundColor Gray
Write-Host "Key 粘贴剪贴板内容，保存后回到这里按 Enter..." -ForegroundColor Gray
Write-Host ""
Write-Host $pub.Trim()
Write-Host ""
Read-Host "添加完成后按 Enter 继续推送"

Push-Location $repoRoot
git remote set-url origin git@github.com:gc0106/agent-status.git
$env:GIT_SSH_COMMAND = "ssh -i `"$keyPath`" -o IdentitiesOnly=yes"
ssh -i $keyPath -o IdentitiesOnly=yes -T git@github.com
git push -u origin main
Pop-Location

Write-Host ""
Write-Host "完成: https://github.com/gc0106/agent-status" -ForegroundColor Green
