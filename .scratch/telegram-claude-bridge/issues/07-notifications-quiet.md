# Notifications + `/quiet`

Status: done
Type: AFK

## Parent

`.scratch/telegram-claude-bridge/PRD.md`

## What to build

Deliver mobile pushes at the moments the owner's attention changes the outcome. A `Notifier` @-mentions the owner (which fires a Telegram push) on three events: approval-needed, turn-complete, and error/crash. Mid-work tool activity stays silent (no ping per tool call). A per-topic `/quiet` command suppresses turn-complete pings while the owner is actively watching, without suppressing approval or error pings.

Depends on the permission slice because approval-needed is one of the trigger events.

## Acceptance criteria

- [ ] An approval-needed event @-mentions the owner
- [ ] A turn-complete event @-mentions the owner
- [ ] An error/crash event @-mentions the owner
- [ ] Mid-work tool activity produces no mention
- [ ] `/quiet` suppresses turn-complete mentions in that topic but still mentions on approval-needed and error
- [ ] Tests via fakes: each trigger event produces a mention; under `/quiet`, turn-complete does not while approval/error still do

## Blocked by

- `03-tiered-permissions-buttons-autonomy.md`
