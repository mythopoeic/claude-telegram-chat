/**
 * The Session seam: wraps one Claude Agent SDK conversation about one project.
 *
 * The rest of the daemon consumes the typed SessionEvent stream and never
 * touches the SDK directly, so renderers, permissions, and notifications are
 * all tested against a fake session emitting scripted events.
 */

export type SessionEvent =
  | { kind: "assistant-text"; text: string }
  | { kind: "tool-request"; id: string; tool: string; input: unknown }
  | { kind: "tool-result"; id: string; tool: string; ok: boolean; summary?: string }
  | { kind: "turn-done" }
  | { kind: "error"; message: string };

export interface Session {
  /**
   * SDK session id, once known, for resume across restarts (slice 5).
   * Null until the first turn assigns one.
   */
  readonly id: string | null;

  /** The project working directory this session is bound to. */
  readonly cwd: string;

  /** Run one turn with the given prompt; yields events as they arrive. */
  send(prompt: string): AsyncIterable<SessionEvent>;

  /** Abort an in-flight turn (slice 6 wires `/stop` to this). */
  abort(): void;
}

/** A tool call awaiting a permission decision. */
export interface ToolRequest {
  tool: string;
  input: unknown;
  toolUseId: string;
}

export type PermissionOutcome =
  | { allow: true; updatedInput?: Record<string, unknown> }
  | { allow: false; reason: string };

/**
 * Decides whether a tool call may proceed. May block (e.g. while waiting for a
 * Telegram button). Injected into a session so the session never knows about
 * Telegram or topics — it just asks for a decision.
 */
export type PermissionHandler = (
  req: ToolRequest,
  signal: AbortSignal,
) => Promise<PermissionOutcome>;

export interface CreateSessionOptions {
  cwd: string;
  model: string;
  /** Resume a prior SDK session by id, if known. */
  resumeId?: string;
  /** Per-tool permission decision. If omitted, the session is read-only-safe. */
  permission?: PermissionHandler;
  /** When true, append a be-terse instruction to the system prompt. */
  concise?: boolean;
}

export interface SessionFactory {
  create(opts: CreateSessionOptions): Session;
}

/**
 * Tools that never mutate state and so are auto-allowed even in read-only mode.
 * Slice 3's PermissionPolicy generalizes this; slice 2 uses it as a hard guard
 * so a live session is safe to demo before approvals exist.
 */
export const SAFE_TOOLS: ReadonlySet<string> = new Set([
  "Read",
  "Glob",
  "Grep",
  "NotebookRead",
  "TodoWrite",
  "WebFetch",
  "WebSearch",
]);
