# Daemon skeleton: long-polling + allowlist + echo

Status: done
Type: HITL

## Parent

`.scratch/telegram-claude-bridge/PRD.md`

## What to build

The minimal always-on daemon that connects a Telegram bot to the machine via long-polling and proves the round-trip. Inbound updates are normalized through a `Transport` seam into typed events (message, command, button-press) carrying sender id, group id, and topic id. A user-id allowlist is enforced on every inbound event: anything from a non-allowlisted sender is silently ignored. As a smoke test, an allowlisted message in the General topic is echoed back.

This slice establishes the `Transport` seam and the fake-Transport test harness that every later slice builds on. Secrets (bot token, allowlisted user ids) come from a gitignored local config.

This is HITL: the code and fake-Transport tests are agent-completable, but live verification requires the human to create the bot, create the forum-mode supergroup, add the bot as admin, and supply the token + their user id.

## Acceptance criteria

- [ ] Daemon connects to Telegram via long-polling (`getUpdates`) using a token from a gitignored local config
- [ ] Inbound updates are normalized through a `Transport` interface into typed events carrying sender/group/topic ids
- [ ] Messages from non-allowlisted senders produce no action and no outbound message
- [ ] An allowlisted message in the General topic is echoed back
- [ ] A `Transport` fake exists and is used to test allowlist + echo behavior without real Telegram
- [ ] Local config (token, allowlist) is gitignored; a non-secret example config is committed
- [ ] (Live, human-verified) a real message from the owner's phone round-trips through a real bot/group

## Blocked by

None - can start immediately
