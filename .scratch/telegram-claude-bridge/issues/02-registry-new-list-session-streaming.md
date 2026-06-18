# Registry + `list`/`new` + read-only-safe session streaming

Status: done
Type: AFK

## Parent

`.scratch/telegram-claude-bridge/PRD.md`

## What to build

The first real pipe: from a Telegram command to a live Claude session about a real repo, streaming its text back. Auto-discover git repos under a configured root into a hand-editable name→path `Registry`. The `list` command (General topic) shows registered projects; `new <name>` opens a forum topic and spawns a `Session` (Agent SDK conversation) with `cwd` set to that repo, loading the repo's CLAUDE.md / `.claude` settings / skills / subagents / MCP for full project parity. Replies in a project topic feed that project's session. Assistant text streams back (a minimal renderer — full text only; richer rendering is a later slice).

Crucially, this slice is **read-only-safe**: mutating tools (writes, bash, git push, deletes) are hard-denied until the permission slice exists, so a live session can be demoed without risk. A session-level default model comes from config.

Establishes the `Session` and `Registry` seams and their fakes.

## Acceptance criteria

- [ ] Git repos under a configured root are discovered into a name→path registry; the registry is hand-editable and honors manual entries
- [ ] `list` in the General topic shows registered project names
- [ ] `new <name>` opens a forum topic bound to that project and starts a session with `cwd` = the repo
- [ ] The session loads the repo's CLAUDE.md / `.claude` settings / skills / subagents / MCP (project parity)
- [ ] Replies in a project topic are routed to that project's session; assistant text is streamed back
- [ ] Mutating tools are denied (read-only) in this slice; reads/grep/list/tests run
- [ ] Default model is read from config
- [ ] Tests drive the flow via fake `Transport` + fake `Session`: `new app-A` starts a session at the resolved path and streams text; unknown name is handled gracefully

## Blocked by

- `01-daemon-skeleton-longpolling-allowlist.md`
