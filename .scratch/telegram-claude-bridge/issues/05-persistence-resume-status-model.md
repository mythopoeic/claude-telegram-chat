# Persistence + resume + `status` + per-topic `/model`

Status: done
Type: AFK

## Parent

`.scratch/telegram-claude-bridge/PRD.md`

## What to build

Make sessions survive daemon restarts. A `Store` seam persists, per topic, the SDK session id, project path, autonomy level, remembered allowlist, and chosen model to local disk (SQLite or JSON). On startup the daemon reads the store; a topic's session is resumed lazily when that topic next receives a message (resume by session id). A turn lost to a crash mid-flight is simply re-sent by the user. A `status` command lists active sessions and whether each is idle, busy, or waiting on approval. A per-topic `/model` command changes the model for that topic and is persisted alongside the rest of the topic state.

## Acceptance criteria

- [ ] Topic state (session id, project path, autonomy level, remembered allowlist, model) is persisted to local disk
- [ ] After a daemon restart, the next message in a topic resumes its session by id and continues the conversation
- [ ] `status` reports each active topic's project and state (idle / busy / waiting-on-approval)
- [ ] `/model <name>` changes the model for that topic and persists it across restarts
- [ ] A mid-flight turn lost to a crash leaves the topic resumable (re-sending the prompt works)
- [ ] Tests: persist a mapping, simulate restart, assert lazy resume routes to the correct topic; `/model` persists and takes effect

## Blocked by

- `02-registry-new-list-session-streaming.md`
