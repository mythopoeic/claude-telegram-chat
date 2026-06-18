import type {
  CreateSessionOptions,
  PermissionHandler,
  Session,
  SessionEvent,
  SessionFactory,
} from "./types.js";

/**
 * Scriptable in-memory session for tests. Each prompt sent yields the next
 * scripted event list (or a default single assistant-text echo). Records every
 * prompt and whether it was aborted.
 */
export class FakeSession implements Session {
  readonly cwd: string;
  id: string | null;
  readonly prompts: string[] = [];
  aborted = false;
  /** The permission handler this session was created with (for tests). */
  permission: PermissionHandler | undefined;

  /** Queue of scripted responses; shift()ed per send(). */
  private readonly scripts: SessionEvent[][] = [];
  private gate?: Promise<void>;
  private openGate?: () => void;

  constructor(cwd: string, id: string | null = null) {
    this.cwd = cwd;
    this.id = id;
  }

  /** Queue the events the next send() should emit. Chainable. */
  script(events: SessionEvent[]): this {
    this.scripts.push(events);
    return this;
  }

  /** Hold the turn open after emitting its events, until release() is called. */
  block(): this {
    this.gate = new Promise<void>((resolve) => {
      this.openGate = resolve;
    });
    return this;
  }

  /** Let a blocked turn finish. */
  release(): void {
    this.openGate?.();
    this.gate = undefined;
  }

  send(prompt: string): AsyncIterable<SessionEvent> {
    this.prompts.push(prompt);
    const events =
      this.scripts.shift() ??
      ([{ kind: "assistant-text", text: `ok: ${prompt}` }, { kind: "turn-done" }] as SessionEvent[]);
    const self = this;
    return (async function* () {
      for (const ev of events) {
        if (self.aborted) return;
        yield ev;
      }
      if (self.gate) await self.gate;
    })();
  }

  abort(): void {
    this.aborted = true;
  }
}

/** Factory that hands out (and remembers) FakeSessions, keyed by cwd. */
export class FakeSessionFactory implements SessionFactory {
  readonly created: FakeSession[] = [];
  /** The options each create() was called with, in order. */
  readonly createdOpts: CreateSessionOptions[] = [];
  /** Optional per-cwd pre-built sessions so a test can script before creation. */
  private readonly prebuilt = new Map<string, FakeSession>();

  prebuild(cwd: string, session: FakeSession): void {
    this.prebuilt.set(cwd, session);
  }

  create(opts: CreateSessionOptions): Session {
    const existing = this.prebuilt.get(opts.cwd);
    const session = existing ?? new FakeSession(opts.cwd, opts.resumeId ?? null);
    session.permission = opts.permission;
    this.created.push(session);
    this.createdOpts.push(opts);
    return session;
  }
}
