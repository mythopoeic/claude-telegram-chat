# Install the bridge as a Scheduled Task: starts at logon, restarts on failure.
# Prereqs: `npm install; npm run build` and a filled-in config.json at the repo root.
# Run in PowerShell (no admin needed for a per-user logon task).
$ErrorActionPreference = "Stop"

$Repo = (Resolve-Path "$PSScriptRoot\..\..").Path
$Node = (Get-Command node).Source
$TaskName = "telegram-claude-bridge"
$Entry = Join-Path $Repo "dist\index.js"
$Log = Join-Path $Repo "data\daemon.log"

if (-not (Test-Path $Entry)) {
  throw "Missing $Entry - run 'npm run build' first."
}
if (-not (Test-Path (Join-Path $Repo "config.json"))) {
  throw "Missing config.json - copy config.example.json and fill it in first."
}
New-Item -ItemType Directory -Force (Join-Path $Repo "data") | Out-Null

# Clean up any prior instance. Stopping the task kills the cmd wrapper but can
# orphan the node child; kill it explicitly so the fresh start doesn't 409
# against a leftover poller on the same bot token.
try { Stop-ScheduledTask -TaskName $TaskName -ErrorAction Stop } catch {}
Get-CimInstance Win32_Process -Filter "name='node.exe'" -ErrorAction SilentlyContinue |
  Where-Object { $_.CommandLine -like "*$Entry*" } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }

# Run node via cmd so stdout/stderr are captured to a log file.
$cmdArgs = "/c `"`"$Node`" `"$Entry`" >> `"$Log`" 2>&1`""
$Action = New-ScheduledTaskAction -Execute "cmd.exe" -Argument $cmdArgs -WorkingDirectory $Repo
# Start at boot AND at logon, so it's up whether or not anyone is signed in.
$Triggers = @(
  (New-ScheduledTaskTrigger -AtStartup),
  (New-ScheduledTaskTrigger -AtLogOn)
)
$Settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable `
  -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) `
  -ExecutionTimeLimit (New-TimeSpan -Seconds 0)
# Run as the current user, "whether logged on or not" (S4U: no stored password),
# NOT elevated. This runs the task NON-interactively so it isn't attached to a
# session console — a logoff/disconnect can no longer Ctrl-C it (exit 0xC000013A),
# and it survives sign-out. Registration still needs an elevated shell.
$Principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" `
  -LogonType S4U -RunLevel Limited

Register-ScheduledTask -TaskName $TaskName -Action $Action -Trigger $Triggers `
  -Settings $Settings -Principal $Principal -Description "Telegram-Claude bridge daemon" -Force | Out-Null
Start-ScheduledTask -TaskName $TaskName

Write-Host "Registered and started scheduled task '$TaskName'."
Write-Host "Log: $Log"
Write-Host "Remove with: deploy\windows\uninstall.ps1"
