# Running the bridge as an always-on service

These templates install the daemon so it **starts on login and restarts if it crashes** —
so it's there when you reach for your phone, without running `npm start` by hand.

One daemon runs per machine (each with its own bot/group). Install on each machine.

## Prerequisites (both platforms)

1. `npm install`
2. `npm run build` — compiles to `dist/index.js` (the service runs this, not `tsx`).
3. A filled-in `config.json` at the repo root (copy `config.example.json`). **Never commit it.**

Re-run `npm run build` after pulling code changes, then restart the service.

## macOS (launchd)

```bash
bash deploy/macos/install.sh      # installs + starts the LaunchAgent
bash deploy/macos/uninstall.sh    # stops + removes it
```

- Starts at login, restarts on crash (`KeepAlive`), backs off 10s on crash loops.
- Logs: `data/daemon.out.log` and `data/daemon.err.log`.
- Check status: `launchctl list | grep telegram-claude-bridge`

## Windows (Scheduled Task)

In PowerShell (no admin needed for a per-user logon task):

```powershell
powershell -ExecutionPolicy Bypass -File deploy\windows\install.ps1
powershell -ExecutionPolicy Bypass -File deploy\windows\uninstall.ps1
```

- Trigger: at logon. Restarts every 1 min on failure, no run-time limit, survives battery.
- Log: `data\daemon.log`.
- Inspect in **Task Scheduler** (task name `telegram-claude-bridge`) or:
  `Get-ScheduledTask telegram-claude-bridge | Get-ScheduledTaskInfo`

### Want it to run before you log in?

The logon task only starts after you sign in (fine for a desktop you stay logged into).
For a true boot service that runs without a login session, use **NSSM**:

```powershell
choco install nssm
nssm install telegram-claude-bridge "C:\Program Files\nodejs\node.exe" "<repo>\dist\index.js"
nssm set telegram-claude-bridge AppDirectory "<repo>"
nssm set telegram-claude-bridge AppStdout "<repo>\data\daemon.log"
nssm set telegram-claude-bridge AppStderr "<repo>\data\daemon.log"
nssm start telegram-claude-bridge
```

(macOS equivalent: install the plist as a `LaunchDaemon` in `/Library/LaunchDaemons`
instead of a per-user `LaunchAgent`. The per-user agent above is simpler and usually enough.)

## Secrets

No template embeds secrets. The daemon reads `config.json` (bot token, allowlist) from the
repo root at startup; it's gitignored. Keep it there and out of version control.
