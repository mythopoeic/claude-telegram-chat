# Telegram–Claude Bridge

> **Portfolio snapshot — personal tool.** This is a working personal project published
> source-available for portfolio review. It's a single-user tool I run on my own machines, not a
> product or a hosted service. It is **not affiliated with, endorsed by, or sponsored by Anthropic
> or Telegram**; "Claude", "Anthropic", and "Telegram" are trademarks of their respective owners.
> See [LICENSE.md](LICENSE.md) (source-available, all rights reserved) and the
> [Security & Safety Model](#security--safety-model) before running it.
>
> ⚠️ **This is remote code execution on your machine, driven by chat messages.** It is built for
> one trusted operator (you). **Exposing this bot to untrusted users is dangerous.** Read the
> [Threat Model](#threat-model--risks) first.

Direct Claude Code on your dev machines from your phone, over Telegram, instead of from a
terminal. Start a session on any project, chat in natural language, approve risky actions with
buttons, get pushed when Claude needs you, and undo a bad turn — all from a pocket.

A daemon runs **per machine**. Each machine is a Telegram **supergroup**; each project is a
**forum topic** inside it. Built on the [Claude Agent SDK](https://www.npmjs.com/package/@anthropic-ai/claude-agent-sdk)
(`@anthropic-ai/claude-agent-sdk`) and [grammY](https://grammy.dev/) (long-polling, no public URL).

```
Telegram supergroup  "Claude — Desktop"   (bot: @your_desktop_bot)
 ├─ General topic        → control plane: list / new / status / help
 ├─ topic: web-app       → a live Claude session at ~/Projects/web-app
 └─ topic: api-server    → another session, runs in parallel
```

## How it works

- **Project parity** — a session runs with `cwd` set to the repo and loads its `CLAUDE.md`,
  `.claude` settings, skills, subagents, and MCP servers. It's your terminal Claude for that
  repo, reached over Telegram — except approvals route to your phone.
- **Tiered permissions** — safe reads/tests run automatically; mutations (writes, bash, push,
  delete) post **Allow / Allow+remember / Deny** buttons and pause until you tap (no timeout).
  `/yolo` runs unattended; `/careful` asks for everything.
- **Curated output** — Claude's prose posts in full; tool activity collapses into one
  "working…" message edited in place; long output is chunked.
- **Notifications** — you're @-mentioned (mobile push) on approvals, turn completion, and
  errors. `/quiet` mutes the completion ping per topic.
- **Concurrency** — mid-turn messages queue; `/stop` aborts a runaway turn; a per-machine cap
  bounds parallel turns. Topics run independently.
- **Undo** — each turn is checkpointed in git (off your branch history); `/undo` rewinds it
  losslessly, `/diff` shows what changed.
- **Persistence** — topic↔session state is saved; sessions resume after a restart.

## Setup (per machine)

### 1. Create the bot and group (from Telegram)

1. **@BotFather** → `/newbot` → get the bot **token**.
2. **@BotFather** → `/setprivacy` → your bot → **Disable** (so it sees all messages, not just
   commands). Then remove & re-add the bot to the group for it to take effect.
3. Create a group → **enable Topics** (Edit → Topics) so it becomes a forum supergroup.
4. Add the bot to the group and make it **admin** with *Manage Topics*.
5. Get your numeric user id from **@userinfobot**.

### 2. Configure and run

```bash
npm install
cp config.example.json config.json   # then edit it (see below)
npm run build
npm start                             # foreground; or install as a service (next section)
```

`config.json` (gitignored — never commit it):

| key                  | meaning                                                        |
|----------------------|---------------------------------------------------------------|
| `machineName`        | label shown in messages, e.g. `"desktop"`                     |
| `botToken`           | BotFather token                                               |
| `allowedUserIds`     | array of Telegram user ids allowed to drive the daemon        |
| `groupChatId`        | restrict to one group, or `null` for any chat you message from|
| `projectRoots`       | dirs scanned for git repos to auto-register                   |
| `projects`           | explicit `name → path` entries (win over discovery)           |
| `defaultModel`       | model alias for new sessions, e.g. `"opus"`                   |
| `maxConcurrentTurns` | max turns running at once on this machine (default 3)         |
| `defaultMachine`     | primary machine's name for a shared group; same on all (default: this machine) |
| `allowYolo`          | allow `/yolo` unattended auto-approve mode (default `false` — see Safety Model) |

### 3. Run as an always-on service

So it starts on login and restarts on crash — see **[deploy/README.md](deploy/README.md)**.
macOS uses `launchd`; Windows uses a Scheduled Task (or NSSM for a pre-login boot service).

## Usage

In the **General** topic:

| command          | what it does                                  |
|------------------|-----------------------------------------------|
| `list`           | show registered projects                      |
| `new <project>`  | open a topic and start a session              |
| `status`         | active sessions, autonomy, and model          |
| `help`           | the command list                              |

In a **project topic**, just talk to Claude. Plus:

| command                       | what it does                                  |
|-------------------------------|-----------------------------------------------|
| `/yolo` `/careful` `/tiered`  | set this topic's approval mode (`/yolo` requires `allowYolo: true`) |
| `/use <machine>`              | choose which machine handles this topic (shared group) |
| `/model <name>`               | set this topic's model                        |
| `/quiet`                      | mute turn-complete pings here                 |
| `/stop`                       | abort the current turn, clear the queue       |
| `/undo` · `/diff`             | rewind / inspect the last turn's changes      |

### Models

`defaultModel` (config) and `/model <name>` accept a short **alias** — which
resolves to the latest model in that family — or a full model id:

| alias    | model               | good for                                   |
|----------|---------------------|--------------------------------------------|
| `opus`   | Claude Opus         | hardest, multi-step work (default)         |
| `sonnet` | Claude Sonnet       | everyday coding; faster and cheaper        |
| `haiku`  | Claude Haiku        | quick edits, simple or high-volume tasks   |
| `fable`  | Fable 5             | latest Fable-family model                  |

Full ids work too, e.g. `claude-opus-4-8`, `claude-sonnet-4-6`,
`claude-haiku-4-5`, `claude-fable-5` — use these to pin a specific version
instead of tracking the family's latest.

## Multiple machines, one project (shared group)

By default each machine has its own group. If the *same* project lives on more
than one machine and you want a single place to drive it, put **both bots in one
shared supergroup** instead:

1. Create one supergroup (Topics enabled); add **both** bots as admins, privacy
   disabled (re-add after disabling).
2. On every machine, set the **same** `defaultMachine` in `config.json` (the
   primary's `machineName`, e.g. `"desktop"`). Keep each machine's own
   `machineName`. The primary wins ties and is the default active machine.
3. Restart each daemon.

`list` is answered by **each** machine for its own projects (labeled), so you
see what's available on both. `new <project>` is created by **whichever machine
has that project**:

- both have it → the primary creates the single topic; the other binds to it
  (by name, case-insensitively) and is available via `/use`.
- only one has it → that machine creates the topic and becomes its default.

Each topic is handled by one machine at a time — switch with **`/use <machine>`**:

```
/use laptop    ▶ the laptop now handles this topic (desktop goes quiet here)
/use desktop   ▶ switch back
```

Note: a machine only binds topics created **while its bot is in the group**, and
binds a topic only if it has that project. Recreate any topics that predate the
shared setup.

## Development

```bash
npm test          # vitest (unit + integration against fakes; real git for checkpoints)
npm run typecheck # tsc --noEmit
npm run build     # emit dist/ for production
```

The code is organized by seam so behavior is tested without real Telegram or the live SDK:
`transport/` (Telegram I/O), `session/` (Agent SDK), `permission/` (policy + approval),
`render.ts`, `store/` (persistence), `checkpoint/` (git undo), `registry/`, `notifier.ts`,
and `router.ts` (the orchestrator). Each has a fake used throughout the tests.

## Architecture

Every external dependency sits behind a seam with a fake, so the orchestrator is tested
end-to-end without touching Telegram, the Agent SDK, or the network. A message flows:

```
   📱 phone (Telegram app)
        │  message / button tap
        ▼
 ┌─────────────────────────── one daemon per machine ───────────────────────────┐
 │                                                                               │
 │   transport/  ──►  router.ts  ──►  permission/        ──►  session/           │
 │   (grammY,         (orchestr-      policy.decide()         (Claude Agent SDK,  │
 │    long-poll;       ator)          tiered/careful/yolo      cwd = the repo)    │
 │    allowlist)          │           + remembered allow)         │              │
 │      ▲                 │                  │                     │ tool call    │
 │      │ replies,        │  auto-allow ◄────┤                     ▼              │
 │      │ buttons,        │                  │ ask         checkpoint/  (git: snap│
 │      │ @-mentions      │                  ▼              each turn off-branch; │
 │      │            render.ts ──► "Allow / Allow+remember / Deny" button         │
 │      │            (curated         │  pauses the session until you tap         │
 │      │             output)         │                                          │
 │   notifier.ts ◄────────┘           └── store/ (JSON: topic↔session, autonomy,  │
 │   (mobile push)                         remembered allowlist, model, path)     │
 │                                    registry/ (scan projectRoots for git repos) │
 └───────────────────────────────────────────────────────────────────────────────┘
```

- **transport/** — normalizes Telegram updates into typed events and enforces the user-id
  allowlist on every inbound event before anything else runs.
- **permission/** — `decide(tool, state)` is a pure function (no I/O); the controller turns an
  `ask` into an inline Telegram approval and blocks the session until the owner taps.
- **session/** — wraps the Claude Agent SDK with `cwd` at the repo, so the session inherits that
  repo's `CLAUDE.md`, `.claude` settings, skills, and MCP servers.
- **checkpoint/** — snapshots each turn in git *off* your branch history, so `/undo` is lossless.
- **store/** — persists per-topic state so sessions resume across daemon restarts.

## Security & Safety Model

**This daemon is remote code execution on your machine, triggered by chat messages.** The safety
model is layered, and the defaults are conservative:

- **Identity — user-id allowlist.** Every inbound event is checked against `allowedUserIds`
  *before any action*. A non-allowlisted sender produces no session action and no reply, even
  inside the correct group (`src/daemon.ts`). There is no public endpoint — the bot only
  long-polls outbound, so there's nothing to reach from the internet.
- **Optional group binding.** Set `groupChatId` to pin the bot to a single supergroup. If left
  `null`, the allowlist is the *only* gate (the bot will answer an allowlisted user from any
  chat) — set it explicitly if you want defense in depth.
- **Approval by default — tiered.** New topics start in `tiered`: safe reads/tests run
  automatically; every mutation (writes, bash outside the allowlist, push, delete) posts an
  inline **Allow / Allow+remember / Deny** prompt and **pauses the session indefinitely** until
  you tap. No timeout, no auto-approve-on-silence.
- **`/yolo` is opt-in and off by default.** The unattended bypass mode is refused unless you set
  `"allowYolo": true` in `config.json`. A fresh install therefore *cannot* be put into
  auto-approve-everything mode without a deliberate config edit. `/careful` (approve everything,
  including reads) and `/tiered` are always available.
- **Secrets stay local.** `config.json` (bot token, user ids) and `data/` (session state, logs)
  are gitignored and never committed — only `config.example.json` with placeholders ships. No
  service template embeds secrets.
- **Reversibility.** Each turn is checkpointed in git off your branch; `/undo` rewinds a bad turn
  losslessly and `/diff` shows what changed.

## Threat Model / Risks

This tool is built for **exactly one trusted operator on machines they control.** Within that
model the risks are bounded; outside it they are severe. Know these before you run it:

- **Anyone on the allowlist gets a shell.** An allowlisted user can make Claude run code, read any
  file the daemon's OS user can read, and push to remotes. Keep `allowedUserIds` to just you.
- **Token compromise is account compromise.** If your bot token leaks, an attacker who also knows
  (or can spoof being added alongside) an allowlisted user id could drive your machine. Treat
  `config.json` like an SSH key: keep it gitignored, never paste it anywhere.
- **`/yolo` removes the human gate.** With `allowYolo: true` and a topic in `/yolo`, mutations run
  with no approval. Use it only for a bounded, watched burst, and prefer leaving it disabled.
- **`groupChatId: null` widens the surface.** It relies solely on the user-id allowlist. Pin a
  group for a second layer.
- **Not multi-tenant. Do not expose this bot to untrusted users.** There is no sandboxing, no
  per-user isolation, and no rate-based abuse protection beyond the allowlist and concurrency
  cap. Adding an untrusted user, or running the daemon as a privileged OS user, turns it into a
  liability. Run it as an ordinary user, in a workspace you control, for yourself only.
