# Curated output rendering

Status: done
Type: AFK

## Parent

`.scratch/telegram-claude-bridge/PRD.md`

## What to build

Turn the raw session event stream into phone-readable, rate-limit-safe Telegram output via a `Renderer` seam. Assistant text posts in full. Tool activity collapses to compact one-liners (e.g. `✎ edited src/app.py`, `▶ pytest → 14 passed ✓`). A single "working…" status line is edited in place rather than re-posted, so a turn with many tool calls produces a handful of updating lines, not a flood. Long tool output is truncated with the full version one tap away (a follow-up message or uploaded file/snippet), respecting Telegram's 4096-character message cap.

## Acceptance criteria

- [ ] Assistant text is delivered in full
- [ ] Tool requests/results render as one-line status entries
- [ ] A single "working…" line is updated in place across a turn (edit, not repost)
- [ ] Output exceeding the 4096-char cap is chunked or uploaded as a file rather than dropped or erroring
- [ ] Long tool output is truncated with a way to retrieve the full version
- [ ] Rendering stays within Telegram rate limits under a burst of tool calls
- [ ] Tests via fake `Transport` + fake `Session`: a scripted stream (text + several tool calls + done) produces exactly the expected curated messages and in-place edits

## Blocked by

- `02-registry-new-list-session-streaming.md`
