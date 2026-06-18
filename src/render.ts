import { basename } from "node:path";
import type { SessionEvent } from "./session/types.js";
import type { Transport } from "./transport/types.js";

/** Telegram's hard cap is 4096 chars; stay under it with margin. */
const TG_LIMIT = 4000;
/** Max tool lines kept in a single working message before trimming the head. */
const MAX_WORKING_LINES = 25;
/**
 * Minimum gap between edits to the working line. Telegram rate-limits
 * editMessageText per chat (~1/s); a busy turn would otherwise hit 429. Rapid
 * updates coalesce into a single trailing edit; the final state always flushes.
 */
const MIN_EDIT_INTERVAL_MS = 1200;

export interface TurnRenderer {
  handle(event: SessionEvent): Promise<void>;
}

/**
 * Curated, rate-limit-friendly rendering of one turn into a topic.
 *
 * - Assistant prose posts as full messages (chunked if over the cap).
 * - Tool activity collapses into a single "working…" message that is edited in
 *   place as calls run and complete, so a 30-tool turn is one updating message,
 *   not 30. A new assistant message "closes" the current working line so the
 *   next batch of tools starts a fresh line below the prose.
 */
export function createTurnRenderer(
  transport: Transport,
  chatId: number,
  topicId?: number,
): TurnRenderer {
  let workingMessageId: number | null = null;
  let lines: { id: string; text: string }[] = [];
  let lastEditAt = 0;
  let pendingTimer: ReturnType<typeof setTimeout> | null = null;

  function renderWorking(done: boolean): string {
    const header = done ? "" : "⏳ working…\n";
    return (header + lines.map((l) => l.text).join("\n")).slice(0, TG_LIMIT);
  }

  function clearPending(): void {
    if (pendingTimer) {
      clearTimeout(pendingTimer);
      pendingTimer = null;
    }
  }

  async function doEdit(done: boolean): Promise<void> {
    if (workingMessageId === null) return;
    lastEditAt = Date.now();
    await transport.edit(chatId, workingMessageId, renderWorking(done));
  }

  /** Create the working line on first use, else schedule a throttled edit. */
  async function bumpWorking(): Promise<void> {
    if (workingMessageId === null) {
      const sent = await transport.send({ chatId, topicId, text: renderWorking(false) });
      workingMessageId = sent.messageId;
      lastEditAt = Date.now();
      return;
    }
    const elapsed = Date.now() - lastEditAt;
    if (elapsed >= MIN_EDIT_INTERVAL_MS) {
      clearPending();
      await doEdit(false);
    } else if (!pendingTimer) {
      // Trailing edit so the last update isn't lost when calls come in bursts.
      pendingTimer = setTimeout(() => {
        pendingTimer = null;
        void doEdit(false);
      }, MIN_EDIT_INTERVAL_MS - elapsed);
      pendingTimer.unref?.();
    }
  }

  /** Flush the final state immediately (cancels any pending throttled edit). */
  async function finalizeWorking(): Promise<void> {
    clearPending();
    if (workingMessageId === null) return;
    await doEdit(true);
  }

  async function postText(text: string): Promise<void> {
    // Finalize and detach the current working line so prose stays below it.
    await finalizeWorking();
    workingMessageId = null;
    lines = [];
    for (const chunk of chunkText(text, TG_LIMIT)) {
      await transport.send({ chatId, topicId, text: chunk });
    }
  }

  async function handle(event: SessionEvent): Promise<void> {
    switch (event.kind) {
      case "assistant-text":
        if (event.text.trim()) await postText(event.text);
        return;
      case "tool-request":
        lines.push({ id: event.id, text: toolLine(event.tool, event.input) });
        if (lines.length > MAX_WORKING_LINES) lines = lines.slice(-MAX_WORKING_LINES);
        await bumpWorking();
        return;
      case "tool-result": {
        const line = lines.find((l) => l.id === event.id);
        if (line && !line.text.endsWith("✓") && !line.text.endsWith("✗")) {
          line.text += event.ok ? " ✓" : " ✗";
          await bumpWorking();
        }
        return;
      }
      case "error":
        await transport.send({ chatId, topicId, text: `⚠️ ${event.message}` });
        return;
      case "turn-done":
        await finalizeWorking();
        return;
    }
  }

  return { handle };
}

/** One-line, phone-readable summary of a tool call. Pure; exported for tests. */
export function toolLine(tool: string, input: unknown): string {
  const o = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  const file = typeof o.file_path === "string" ? basename(o.file_path) : undefined;
  switch (tool) {
    case "Read":
      return `📖 read ${file ?? ""}`.trim();
    case "Edit":
    case "MultiEdit":
    case "Write":
    case "NotebookEdit":
      return `✎ ${tool.toLowerCase()} ${file ?? ""}`.trim();
    case "Bash":
      return `▶ ${short(o.command)}`;
    case "Grep":
      return `🔍 grep ${quote(o.pattern)}`;
    case "Glob":
      return `🔍 glob ${short(o.pattern)}`;
    case "WebFetch":
    case "WebSearch":
      return `🌐 ${short(o.url ?? o.query)}`;
    default:
      return `• ${tool}`;
  }
}

/** Split text into Telegram-sized chunks, preferring newline boundaries. */
export function chunkText(text: string, limit: number): string[] {
  if (text.length <= limit) return [text];
  const out: string[] = [];
  let rest = text;
  while (rest.length > limit) {
    let cut = rest.lastIndexOf("\n", limit);
    if (cut <= 0) cut = limit;
    out.push(rest.slice(0, cut));
    rest = rest.slice(cut).replace(/^\n/, "");
  }
  if (rest) out.push(rest);
  return out;
}

function short(v: unknown, n = 80): string {
  const s = typeof v === "string" ? v : String(v ?? "");
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

function quote(v: unknown): string {
  return `"${short(v, 60)}"`;
}
