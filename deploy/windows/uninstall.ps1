# Stop and remove the scheduled task.
$ErrorActionPreference = "Stop"
$TaskName = "telegram-claude-bridge"

try { Stop-ScheduledTask -TaskName $TaskName -ErrorAction Stop } catch {}
Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
Write-Host "Removed scheduled task '$TaskName'."
