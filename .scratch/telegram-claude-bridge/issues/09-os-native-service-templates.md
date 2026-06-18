# OS-native service templates

Status: done
Type: AFK

## Parent

`.scratch/telegram-claude-bridge/PRD.md`

## What to build

Make the daemon a real always-on service on both machines, so it's reliably there when reached from a phone days later. Ship OS-native service definitions as templates: a `launchd` LaunchAgent for macOS, and a Task Scheduler job (logon trigger + restart-on-failure) and/or an NSSM service recipe for Windows. Each auto-starts the daemon on boot/login and auto-restarts it on crash, reading the same gitignored local config. Include short setup docs for installing on each OS.

Authoring and dry-validating the templates is agent-completable; actually installing them on the owner's two machines is a manual step performed by the owner.

## Acceptance criteria

- [ ] A macOS `launchd` template starts the daemon on login and restarts it on crash
- [ ] A Windows template (Task Scheduler logon+restart, and/or NSSM service) starts the daemon on boot/login and restarts it on crash
- [ ] Templates reference the gitignored local config and do not embed secrets
- [ ] Setup docs explain installing/uninstalling the service on each OS
- [ ] Templates are validated for correctness (e.g. plist/scheduler syntax) as far as possible without the owner's machines

## Blocked by

- `01-daemon-skeleton-longpolling-allowlist.md`
