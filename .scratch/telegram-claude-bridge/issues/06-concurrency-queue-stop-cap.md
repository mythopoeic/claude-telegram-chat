# Concurrency: queue + `/stop` + per-machine cap

Status: done
Type: AFK

## Parent

`.scratch/telegram-claude-bridge/PRD.md`

## What to build

Define how the daemon behaves under concurrent activity. A message sent to a topic whose session is mid-turn is queued and delivered as the next prompt when the current turn finishes (the "also do X" case). A `/stop` command (or Stop affordance) aborts the current turn immediately. Multiple project topics run concurrently and independently — one topic paused on an approval does not block others. A per-machine cap bounds how many turns run simultaneously to avoid thrashing the machine; work beyond the cap queues.

## Acceptance criteria

- [ ] A message arriving mid-turn is queued and run as the next prompt, not dropped or run concurrently within the same topic
- [ ] `/stop` aborts the current turn promptly and the topic returns to idle
- [ ] Multiple topics progress concurrently; a topic paused on approval does not stall other topics
- [ ] A per-machine concurrency cap limits simultaneous running turns; excess turns queue
- [ ] Tests via fakes: a second message during a turn is queued and later delivered; `/stop` invokes session abort; cap is respected under multiple concurrent topics

## Blocked by

- `02-registry-new-list-session-streaming.md`
