# Tiered permissions + Allow/Deny buttons + `/yolo`·`/careful`

Status: done
Type: AFK

## Parent

`.scratch/telegram-claude-bridge/PRD.md`

## What to build

The approval gate that makes a remote session safe. Introduce a `PermissionPolicy` seam — a pure `decide(toolRequest, policy) → auto-allow | ask | auto-deny` function driven by a safe-tool allowlist, the topic's remembered allowlist, and the topic's autonomy dial. Safe reads/tests auto-allow; mutating actions (writes, bash outside the allowlist, push, deletes) post an inline **Allow / Allow+remember / Deny** prompt into the topic and **pause that session indefinitely** until the owner taps. "Allow + remember" promotes the tool/pattern to the topic's remembered allowlist so it isn't re-asked. `/yolo` flips the topic to bypass-all; `/careful` flips to ask-all; default is the tiered middle. The Telegram policy overrides the repo's own permission configuration.

This replaces the blanket read-only denial from slice 2 with real, decision-based gating.

## Acceptance criteria

- [ ] `PermissionPolicy.decide(...)` is a pure function with table-driven unit tests across safe/mutating tools, remembered-allowlist hits, and each autonomy dial
- [ ] A mutating tool request posts an Allow / Allow+remember / Deny prompt and the session makes no further progress until a button event arrives
- [ ] Deny reports the tool as denied to the session; Allow proceeds; Allow+remember adds it to the topic allowlist and suppresses re-asking
- [ ] A pending approval stays pending indefinitely (no timeout)
- [ ] `/yolo` runs mutating tools without prompting in that topic; `/careful` prompts on every tool; default is tiered
- [ ] The Telegram policy overrides the repo's local permission settings
- [ ] End-to-end test via fakes: a `bash` request under the tiered policy sends a prompt, pauses, and resolves correctly on Allow vs Deny

## Blocked by

- `02-registry-new-list-session-streaming.md`
