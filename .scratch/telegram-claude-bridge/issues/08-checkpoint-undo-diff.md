# Auto-checkpoint + `/undo`·`/diff`

Status: done
Type: AFK

## Parent

`.scratch/telegram-claude-bridge/PRD.md`

## What to build

The recovery net that makes unattended `/yolo` sane. A `Checkpointer` over the project's git repo snapshots the working state before each turn's mutations — a WIP commit on a shadow ref or a `git stash create` snapshot — including pre-existing uncommitted changes so recovery is lossless. `/undo` rewinds the working tree to the pre-turn checkpoint; `/diff` shows what the turn changed. Checkpoints live off the real branch history and are pruned over time so the commit log stays clean.

Because git semantics are the behavior being promised, this slice is tested against a real git repo in a throwaway directory.

## Acceptance criteria

- [ ] A checkpoint is recorded before a turn's first mutation, capturing the working tree including pre-existing uncommitted changes
- [ ] `/undo` restores the working tree to the exact pre-turn state, losslessly
- [ ] `/diff` reports the changes a turn made
- [ ] Checkpoints do not appear on the working branch's history
- [ ] Old checkpoints are pruned
- [ ] Tests run against a real git repo in a temp directory: checkpoint → mutate → `/undo` restores (incl. uncommitted), `/diff` reports changes, history stays clean, pruning works

## Blocked by

- `02-registry-new-list-session-streaming.md`
