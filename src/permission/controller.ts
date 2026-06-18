import type { Logger } from "../daemon.js";
import type { Notifier } from "../notifier.js";
import type { PermissionHandler, PermissionOutcome, ToolRequest } from "../session/types.js";
import type { Transport } from "../transport/types.js";
import { decide, type Autonomy } from "./policy.js";

interface TopicState {
  autonomy: Autonomy;
  remembered: Set<string>;
}

interface Pending {
  resolve: (outcome: PermissionOutcome) => void;
  tool: string;
  remembered: Set<string>;
  chatId: number;
  /** Topic key, so a remembered-allow can be persisted. */
  key: string;
  /** Set once the approval prompt has been posted, so it can be finalized. */
  messageId?: number;
}

/** Notified when a topic's autonomy or remembered allowlist changes. */
export type PermissionChange = (key: string, autonomy: Autonomy, remembered: string[]) => void;

/** Callback-data prefix identifying an approval button press. */
const PREFIX = "p";

/**
 * Owns per-topic autonomy state and the live approval round-trip. When the
 * policy says "ask", it posts Allow / Allow+remember / Deny buttons into the
 * topic and returns a promise that stays pending until the matching button
 * press arrives (or the turn aborts). Pending approvals never time out.
 */
export class PermissionController {
  private readonly states = new Map<string, TopicState>();
  private readonly pending = new Map<string, Pending>();
  private counter = 0;
  private onChange?: PermissionChange;

  constructor(
    private readonly transport: Transport,
    private readonly logger: Logger,
    private readonly notifier?: Notifier,
  ) {}

  /** Register a listener for autonomy/remembered changes (for persistence). */
  setOnChange(cb: PermissionChange): void {
    this.onChange = cb;
  }

  /** Restore a topic's state from persistence without firing onChange. */
  restore(key: string, autonomy: Autonomy, remembered: string[]): void {
    this.states.set(key, { autonomy, remembered: new Set(remembered) });
  }

  mode(key: string): Autonomy {
    return this.states.get(key)?.autonomy ?? "tiered";
  }

  setMode(key: string, autonomy: Autonomy): void {
    const state = this.ensure(key);
    state.autonomy = autonomy;
    this.onChange?.(key, autonomy, [...state.remembered]);
  }

  /** Build a permission handler bound to a specific topic. */
  handlerFor(chatId: number, topicId: number | undefined, key: string): PermissionHandler {
    return async (req, signal) => {
      const state = this.ensure(key);
      const decision = decide(req.tool, state);
      if (decision === "auto-allow") return { allow: true };
      if (decision === "auto-deny") return { allow: false, reason: "denied by policy" };
      return this.ask(chatId, topicId, key, state, req, signal);
    };
  }

  /**
   * Resolve a pending approval from a button press. Returns true if the data
   * matched a known pending approval.
   */
  resolveCallback(data: string): boolean {
    const parts = data.split("|");
    if (parts[0] !== PREFIX || parts.length !== 3) return false;
    const [, id, verb] = parts;
    const pending = id ? this.pending.get(id) : undefined;
    if (!id || !pending) return false;

    this.pending.delete(id);
    let label: string;
    if (verb === "y") {
      label = "✅ allowed";
      pending.resolve({ allow: true });
    } else if (verb === "r") {
      pending.remembered.add(pending.tool);
      label = "♾️ allowed (remembered)";
      this.onChange?.(pending.key, this.mode(pending.key), [...pending.remembered]);
      pending.resolve({ allow: true });
    } else {
      label = "⛔ denied";
      pending.resolve({ allow: false, reason: "denied by you" });
    }

    // Finalize the prompt in place: show the decision and drop the buttons.
    if (pending.messageId !== undefined) {
      this.transport
        .edit(pending.chatId, pending.messageId, `${pending.tool} — ${label}`)
        .catch((err) => this.logger.warn(`failed to finalize approval: ${(err as Error).message}`));
    }
    return true;
  }

  private ask(
    chatId: number,
    topicId: number | undefined,
    key: string,
    state: TopicState,
    req: ToolRequest,
    signal: AbortSignal,
  ): Promise<PermissionOutcome> {
    const id = String(++this.counter);
    return new Promise<PermissionOutcome>((resolve) => {
      const pending: Pending = { resolve, tool: req.tool, remembered: state.remembered, chatId, key };
      this.pending.set(id, pending);

      const onAbort = () => {
        if (this.pending.delete(id)) resolve({ allow: false, reason: "aborted" });
      };
      if (signal.aborted) {
        onAbort();
        return;
      }
      signal.addEventListener("abort", onAbort, { once: true });

      this.transport
        .send({
          chatId,
          topicId,
          text: `🔐 Claude wants to use ${req.tool}${describeInput(req.input)}`,
          buttons: [
            [
              { text: "✅ Allow", data: `${PREFIX}|${id}|y` },
              { text: "♾️ Allow + remember", data: `${PREFIX}|${id}|r` },
              { text: "⛔ Deny", data: `${PREFIX}|${id}|n` },
            ],
          ],
          mentionUserIds: this.notifier?.mentions(),
        })
        .then((sent) => {
          pending.messageId = sent.messageId;
        })
        .catch((err) => this.logger.warn(`failed to post approval: ${(err as Error).message}`));
    });
  }

  private ensure(key: string): TopicState {
    let state = this.states.get(key);
    if (!state) {
      state = { autonomy: "tiered", remembered: new Set() };
      this.states.set(key, state);
    }
    return state;
  }
}

/** Short, safe one-line description of a tool's input for the prompt. */
function describeInput(input: unknown): string {
  if (input && typeof input === "object") {
    const o = input as Record<string, unknown>;
    const detail = o.command ?? o.file_path ?? o.path ?? o.url;
    if (typeof detail === "string") {
      const trimmed = detail.length > 120 ? `${detail.slice(0, 117)}…` : detail;
      return `:\n${trimmed}`;
    }
  }
  return "";
}
