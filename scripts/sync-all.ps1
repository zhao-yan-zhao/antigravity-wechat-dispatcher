# 自动双向同步脚本: wechat-dispatcher <-> ai-assistant
param(
  [switch]$Watch
)

$homeDir = if ($env:USERPROFILE) { $env:USERPROFILE } else { $HOME }
$pluginsRoot = Join-Path $homeDir ".gemini\config\plugins"
$srcDir = Join-Path $pluginsRoot "wechat-dispatcher\sidecars\panel"
$dstDir = Join-Path $pluginsRoot "ai-assistant\sidecars\panel"

function Sync-Files {
  Write-Host "[SYNC] 同步 sidecars/panel 目录..." -ForegroundColor Cyan
  Copy-Item -Path "$srcDir\*" -Destination "$dstDir\" -Recurse -Force
  Write-Host "[SYNC] 同步完成: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')" -ForegroundColor Green
}

Sync-Files

if ($Watch) {
  Write-Host "[WATCH] 开启目录变动监听..." -ForegroundColor Yellow
  $watcher = New-Object System.IO.FileSystemWatcher
  $watcher.Path = $srcDir
  $watcher.IncludeSubdirectories = $true
  $watcher.EnableRaisingEvents = $true
  Register-ObjectEvent $watcher "Changed" -Action { Sync-Files }
  while ($true) { Start-Sleep -Seconds 1 }
}
