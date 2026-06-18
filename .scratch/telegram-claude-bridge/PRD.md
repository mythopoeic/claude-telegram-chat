# PRD: Telegram–Claude Bridge

Status: done

A drop-in daemon that lets you direct Claude Code on your dev machines from your phone, over Telegram, instead of from a terminal window.

## Problem Statement

I run Claude Code agents on two machines — a Windows 11 desktop and a macOS 13 laptop — but I can only direct them from a terminal window at the keyboard. When I'm away from my desk (out, on my phone), I can't start work, answer Claude's questions, approve a risky action, or even see whether a long task finished. My projects stall whenever I'm not physically at the machine, and the terminal's interactive permission prompts have no remote equivalent, so I can't safely let an agent keep working while I'm gone.

## Solution

A single always-on daemon per machine that bridges Telegram to the Claude Agent SDK. Each machine is a Telegram supergroup; each project is a forum topic inside it. From my phone I can start a session on any registered project, chat with Claude in natural language, watch a curated stream of what it's doing, approve or deny risky actions with inline buttons, get pushed a notification when it needs me or finishes, and undo a bad turn with one word. It behaves like the same Claude Code I'd get in that repo's terminal — same CLAUDE.md, skills, subagents, and MCP — except the permission gate is relocated to my phone, and every turn is checkpointed so I can roll back. The result: I can develop my projects from anywhere, hands-off when I trust the agent and hands-on when I don't.

## User Stories

1. As a developer away from my desk, I want to message a bot on my phone and have Claude act on my project, so that I can keep making progress without being at the keyboard.
2. As an owner of two machines, I want each machine to have its own Telegram group, so that I can clearly choose which machine I'm directing.
3. As a user, I want to type `list` in a machine's group and see its registered projects, so that I can discover what I can work on without remembering paths.
4. As a user, I want the daemon to auto-discover git repos under a configured root, so that new projects are available with near-zero setup.
5. As a user, I want to hand-edit the project registry, so that I can include or alias a repo that lives outside the scanned root.
6. As a user, I want to type `new app-A` and get a dedicated forum topic bound to that project, so that each project has its own conversation.
7. As a user, I want every reply in a project's topic to feed that project's session, so that the conversation has continuity like a normal Claude session.
8. As a user, I want to run multiple project topics at once, so that I can have several projects progressing concurrently on the same machine.
9. As a user, I want Claude's text responses delivered in full, so that I can read its reasoning and answers.
10. As a user, I want tool activity collapsed into compact one-line status updates, so that my phone isn't flooded and I stay under Telegram's rate limits.
11. As a user, I want a single "working…" line that updates in place, so that a turn with many tool calls doesn't spam the topic.
12. As a user, I want long tool output truncated with a way to see the full version, so that I can drill in when I need to without wading through dumps.
13. As a user, I want safe read-only actions (reads, grep, listing, running tests) auto-approved, so that I'm not interrupted for harmless steps.
14. As a user, I want risky actions (file writes, bash, git push, deletes) to prompt me with Allow / Allow+remember / Deny buttons, so that I stay in control of anything that mutates state.
15. As a user, I want "Allow + remember" to stop re-asking for that tool/pattern in this topic, so that repetitive approvals don't pile up.
16. As a user, I want a pending approval to pause that session indefinitely until I respond, so that nothing happens behind my back and nothing times out while I'm away for hours.
17. As a user, I want other topics to keep working while one waits on my approval, so that one blocked project doesn't stall the others.
18. As a user, I want a `/yolo` command to let a topic run unattended without prompts for a trusted burst, so that I can hand off a refactor and review later.
19. As a user, I want a `/careful` command to make a topic ask before every action, so that I can supervise closely when stakes are high.
20. As a user, I want to send a follow-up message while the agent is mid-turn and have it queued, so that I can add "also do X" without disrupting the current work.
21. As a user, I want a `/stop` command to abort the current turn immediately, so that I can halt the agent when it's going wrong.
22. As a user, I want to be @-mentioned (and pushed a notification) when the agent needs my approval, so that I can unblock it promptly.
23. As a user, I want to be @-mentioned when a turn completes, so that I know it's my move again without repeatedly checking.
24. As a user, I want to be @-mentioned when a session errors or crashes, so that a dead session doesn't sit silently.
25. As a user, I want mid-work tool activity to stay silent (no ping per tool call), so that notifications stay meaningful.
26. As a user, I want a `/quiet` command per topic to suppress completion pings, so that I'm not buzzed while I'm actively watching.
27. As a user, I want each project session to load that repo's CLAUDE.md, skills, subagents, and MCP servers, so that it behaves like the Claude Code I'd run in that project's terminal.
28. As a user, I want the Telegram permission model to override the repo's local permission settings, so that approvals always route to my phone regardless of what the repo assumed about a local terminal.
29. As a user, I want a checkpoint taken before each turn's mutations, so that any turn is recoverable.
30. As a user, I want a `/undo` command to rewind the working tree to the pre-turn state, so that I can recover from a bad turn with one word on my phone.
31. As a user, I want `/undo` to also restore pre-existing uncommitted changes, so that recovery is lossless.
32. As a user, I want a `/diff` command to show what a turn changed, so that I can review before keeping or undoing it.
33. As a user, I want checkpoints stored off my real git history and pruned over time, so that my commit log stays clean.
34. As a user, I want the daemon to ignore any sender not on an allowlist, so that only I can trigger code execution on my machines.
35. As a user, I want secrets (bot token, config) kept in a gitignored local file, so that they never get committed when the project is shared.
36. As a user, I want the daemon to auto-start on boot and auto-restart on crash, so that it's reliably there when I reach for my phone days later.
37. As a user, I want the topic-to-session mapping persisted to disk, so that sessions survive a daemon restart.
38. As a user, I want a session resumed when I next message its topic after a restart, so that I can pick up where I left off.
39. As a user, I want a `status` command, so that I can see which sessions are active, busy, or waiting on me.
40. As a user, I want the same command vocabulary on both machines' bots, so that I don't have to remember per-machine differences.
41. As a user, I want a default model configured for sessions, so that dev work uses a capable model without per-session setup.
42. As a user, I want an optional per-topic `/model` switch, so that I can change the model for a specific project when needed.
43. As a user, I want the daemon to cap how many turns run at once on a machine, so that concurrent sessions don't thrash the machine.
44. As a user, I want to set up each machine once from templates, so that getting a new machine online is a short, documented chore.

## Implementation Decisions

**Engine & runtime**
- Built on the **Claude Agent SDK** (not by wrapping the `claude` CLI), chosen for its `canUseTool` callback, hooks, and programmatic message streaming — the foundation for relocating permission prompts to the phone.
- **TypeScript/Node**, using **grammY** for the Telegram layer. The Agent SDK's TypeScript maturity is the tiebreaker; the Telegram library choice is otherwise a wash between ecosystems.

**Topology**
- **One daemon process per machine.** A daemon only runs tools on its own machine, so the Windows and macOS boxes each run their own instance.
- **One Telegram bot per machine** (forced: only one consumer may long-poll a bot token; two would `409 Conflict`).
- **Transport: Telegram long-polling** (`getUpdates`), outbound-only — NAT-friendly, no public host, single bot token.

**Telegram structure**
- **Machine = a forum-mode supergroup** (e.g. "Claude — Desktop" / "Claude — Laptop") with that machine's bot as an admin member (admin needed to manage topics).
- **Project = a forum topic** within the group. Replies in a topic feed that project's session.
- **General topic = control plane** for `list`, `new <name>`, `status`.

**Modules / seams** (interfaces, not file paths)
- `Transport` — abstracts the bot: inbound updates normalize to typed events (message, command, button-press) carrying sender id, group id, topic id; outbound supports send / edit-in-place / file-upload. Enables testing the daemon without real Telegram.
- `Session` — wraps an Agent SDK conversation for one project: `send(prompt)` returns an async stream of typed events (assistant-text, tool-request, tool-result, turn-done, error); supports resume-by-id and abort.
- `PermissionPolicy` — a pure decision function `decide(toolRequest, policy) → auto-allow | ask | auto-deny`, driven by the safe-tool allowlist, the topic's remembered allowlist, and the topic's autonomy dial (tiered / yolo / careful).
- `Registry` — auto-discovers git repos under configured root(s) into a hand-editable name→path map; resolves `new <name>` to a working directory.
- `Renderer` — turns the `Session` event stream into curated Telegram output: full assistant text, one-line tool-status, an in-place-edited "working…" line, truncation + upload for overflow (Telegram 4096-char cap).
- `Checkpointer` — over the project's git repo, snapshots a pre-turn state (WIP commit on a shadow ref or `git stash create`, including pre-existing uncommitted changes), and supports `undo` (lossless rewind), `diff` (turn changes), and pruning.
- `Store` — persists topic→{session id, project path, autonomy level, remembered allowlist} to local disk (SQLite or JSON); read on startup, sessions resumed lazily on next message.
- `Notifier` — @-mentions the user on approval-needed, turn-complete, and error events; honors per-topic `/quiet`.

**Behavior contracts**
- **Permissions:** safe reads/tests auto-approved and streamed as status; mutating actions (writes, bash outside allowlist, push, deletes) post inline Allow / Allow+remember / Deny and pause the session indefinitely. `/yolo` = bypass-all burst; `/careful` = ask-all; default = tiered.
- **Concurrency:** mid-turn messages queue as the next prompt; `/stop` aborts the current turn; a per-machine cap bounds simultaneous running turns.
- **Project parity:** sessions run with `cwd` = repo and load the repo's CLAUDE.md / `.claude` settings / skills / subagents / MCP, but the Telegram `PermissionPolicy` overrides the repo's local permission configuration.
- **Recovery:** a checkpoint precedes each turn's mutations; `/undo` rewinds (incl. uncommitted pre-existing changes), `/diff` shows changes, checkpoints live off real history and are pruned.
- **Security:** sender user-id allowlist enforced on every inbound event (non-allowlisted silently ignored even within the correct group); secrets in a gitignored local config; intended for a personal Telegram account.
- **Lifecycle:** OS-native service per machine — `launchd` on macOS, Task Scheduler (logon trigger + restart-on-failure) or NSSM on Windows — shipped as setup templates; auto-start on boot, auto-restart on crash.

**Command vocabulary** (identical on both bots): `list`, `new <name>`, `status`, `/stop`, `/yolo`, `/careful`, `/quiet`, `/undo`, `/diff`, `/model`.

## Testing Decisions

Tests assert **external behavior at the highest available seam**, not internal implementation. Prefer driving the daemon through the `Transport` and `Session` seams with fakes over reaching into modules.

- **End-to-end daemon flow (highest seam):** drive the daemon via a **fake `Transport`** (feed normalized updates) and a **fake `Session`** (emit scripted event streams). Assert observable outcomes:
  - `new app-A` → a topic-bound session is started at the resolved repo path and curated output is sent.
  - An assistant-text + tool-request + turn-done stream → exactly the curated messages expected (full text, one-line status, an in-place-edited working line), respecting truncation.
  - A `bash` tool-request under the tiered policy → an Allow/Deny prompt is sent and no further session progress occurs until a button event arrives; Deny → the tool is reported denied.
  - A second message during a turn → queued and delivered as the next prompt; `/stop` → abort is invoked on the session.
  - Approval-needed / turn-complete / error → an @-mention is sent; under `/quiet`, completion does not.
  - An inbound event from a non-allowlisted sender → no session action and no outbound message.
- **`PermissionPolicy` (pure unit tests):** table-driven `decide(...)` cases across safe vs mutating tools, remembered-allowlist hits, and each autonomy dial — zero I/O.
- **`Checkpointer` (real dependency, throwaway repo):** git is the behavior under test, so test against a **real git repo in a temp directory**. Cases: checkpoint then mutate then `/undo` restores the exact prior tree including pre-existing uncommitted changes; `/diff` reports a turn's changes; checkpoints don't appear on the working branch's history; pruning removes old checkpoints.
- **`Registry`:** given a temp directory tree with and without `.git`, assert discovered names/paths and that hand-added entries are honored.
- **`Store`:** persist a mapping, simulate restart, assert sessions resume lazily on next message for the right topic.

Good tests here describe *what the user observes* ("an Allow/Deny prompt appears and the agent waits"), never *how* it's wired. Fakes stand in for Telegram and the Agent SDK at their interface boundaries; the only real external dependency exercised directly is git, because git semantics are what the checkpoint/undo feature promises.

There is no prior art in this repo (greenfield); these seams and their fakes establish the testing convention.

## Out of Scope

- Background or scheduled tasks that outlive a single turn (e.g. "run nightly").
- Multi-user access; this is a single-user personal tool with a user-id allowlist.
- Voice messages, image input, or other non-text Telegram modalities.
- Non-git projects (auto-discovery and the checkpoint/undo feature assume git).
- A relay/cloud-hosted topology; the daemon runs on the machine that holds the code.
- Slack and Discord transports (Telegram chosen; the `Transport` seam leaves the door open but no other transport is built).
- Cross-machine routing (one daemon cannot act on the other machine's filesystem; you address a machine by choosing its group).

## Further Notes

- **Platform choice rationale:** Telegram was chosen over Slack and Discord for the simplest setup (one BotFather token, no workspace/manifest/OAuth), the simplest NAT story (outbound long-polling, no app-level token), the most reliable mobile push, no message-history cap, and a trivial user-id allowlist. The cost is that "thread per project" is realized via forum topics rather than arbitrary threads — acceptable for a single user.
- **Known Telegram constraints to design around:** 4096-char message cap (chunk or upload); the bot must be a group admin to create/manage topics; only one long-poll consumer per bot token.
- **The `Transport` seam is deliberately platform-agnostic**, so a future Slack/Discord transport could be added without touching session, permission, rendering, or checkpoint logic — but that is explicitly not built now.
- **Suggested build order** (each a working vertical slice): (1) daemon skeleton + grammY long-polling + allowlist, echoing in General; (2) registry/discovery + `new`/`list` + a session streaming curated text; (3) permission tier + Allow/Deny buttons + `/yolo`·`/careful`; (4) persistence + restart resume + `/stop` + queueing; (5) notifications + `/quiet`; (6) auto-checkpoint + `/undo`/`/diff`; (7) OS-native service templates for both machines.
