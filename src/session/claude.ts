import { query } from "@anthropic-ai/claude-agent-sdk";
import type { Options, PermissionResult } from "@anthropic-ai/claude-agent-sdk";
import {
  SAFE_TOOLS,
  type CreateSessionOptions,
  type PermissionHandler,
  type Session,
  type SessionEvent,
  type SessionFactory,
} from "./types.js";

/** Loose view of a content block — avoids importing the full Anthropic types. */
interface Block {
  type: string;
  text?: string;
  id?: string;
  name?: string;
  input?: unknown;
  tool_use_id?: string;
  is_error?: boolean;
}

/**
 * Real Session backed by the Claude Agent SDK. One ClaudeSession is one ongoing
 * conversation about one project; each send() runs a turn and resumes the prior
 * SDK session so context carries across messages.
 *
 * Slice 2 is read-only-safe: canUseTool allows only SAFE_TOOLS and denies every
 * mutating tool. Slice 3 replaces this guard with the full PermissionPolicy.
 */
export class ClaudeSession implements Session {
  id: string | null;
  readonly cwd: string;
  private readonly model: string;
  private readonly permission: PermissionHandler | undefined;
  private abortController: AbortController | null = null;

  constructor(opts: CreateSessionOptions) {
    this.cwd = opts.cwd;
    this.model = opts.model;
    this.permission = opts.permission;
    this.id = opts.resumeId ?? null;
  }

  async *send(prompt: string): AsyncIterable<SessionEvent> {
    const abort = new AbortController();
    this.abortController = abort;

    const options: Options = {
      cwd: this.cwd,
      model: this.model,
      // Project parity: load the repo's CLAUDE.md, .claude settings, skills,
      // subagents, and MCP servers, plus the user's global config.
      settingSources: ["user", "project", "local"],
      tools: { type: "preset", preset: "claude_code" },
      abortController: abort,
      canUseTool: async (toolName, input, { signal, toolUseID }): Promise<PermissionResult> => {
        if (this.permission) {
          const outcome = await this.permission(
            { tool: toolName, input, toolUseId: toolUseID },
            signal,
          );
          return outcome.allow
            ? { behavior: "allow", updatedInput: outcome.updatedInput ?? input }
            : { behavior: "deny", message: outcome.reason };
        }
        // No handler injected: read-only-safe fallback (used by tests/standalone).
        if (SAFE_TOOLS.has(toolName)) return { behavior: "allow", updatedInput: input };
        return { behavior: "deny", message: "Read-only mode: mutating tools disabled." };
      },
      ...(this.id ? { resume: this.id } : {}),
    };

    try {
      for await (const msg of query({ prompt, options })) {
        // Capture/confirm the SDK session id for resume on later turns.
        if ("session_id" in msg && typeof msg.session_id === "string") {
          this.id = msg.session_id;
        }
        yield* translate(msg);
        if (msg.type === "result") return;
      }
    } catch (err) {
      if (abort.signal.aborted) return;
      yield { kind: "error", message: err instanceof Error ? err.message : String(err) };
    } finally {
      this.abortController = null;
    }
  }

  abort(): void {
    this.abortController?.abort();
  }
}

function* translate(msg: { type: string; message?: unknown; subtype?: string }): Generator<SessionEvent> {
  if (msg.type === "assistant") {
    const content = (msg.message as { content?: Block[] | string } | undefined)?.content;
    for (const block of asBlocks(content)) {
      if (block.type === "text" && block.text) {
        yield { kind: "assistant-text", text: block.text };
      } else if (block.type === "tool_use") {
        yield {
          kind: "tool-request",
          id: block.id ?? "",
          tool: block.name ?? "",
          input: block.input,
        };
      }
    }
    return;
  }

  if (msg.type === "user") {
    const content = (msg.message as { content?: Block[] | string } | undefined)?.content;
    for (const block of asBlocks(content)) {
      if (block.type === "tool_result") {
        yield {
          kind: "tool-result",
          id: block.tool_use_id ?? "",
          tool: "",
          ok: block.is_error !== true,
        };
      }
    }
    return;
  }

  if (msg.type === "result") {
    if (msg.subtype && msg.subtype !== "success") {
      yield { kind: "error", message: `turn ended: ${msg.subtype}` };
    }
    yield { kind: "turn-done" };
  }
}

function asBlocks(content: Block[] | string | undefined): Block[] {
  if (Array.isArray(content)) return content;
  return [];
}

/** Creates real Agent-SDK-backed sessions. */
export class ClaudeSessionFactory implements SessionFactory {
  create(opts: CreateSessionOptions): Session {
    return new ClaudeSession(opts);
  }
}
