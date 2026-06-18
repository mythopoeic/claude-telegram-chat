import { describe, it, expect } from "vitest";
import { createRouter } from "../src/router.js";
import { FakeTransport } from "../src/transport/fake.js";
import { FakeSession, FakeSessionFactory } from "../src/session/fake.js";
import { registryFrom } from "../src/registry/discover.js";
import { FakeStore } from "../src/store/fake.js";
import { FakeCheckpointer } from "../src/checkpoint/fake.js";
import { FakeTranscriber } from "../src/transcribe/fake.js";
import type { Transcriber } from "../src/transcribe/types.js";
import type { Config } from "../src/config.js";
import type { CommandEvent, MessageEvent, VoiceEvent } from "../src/transport/types.js";

const quiet = { info: () => {}, warn: () => {} };
const CHAT = -100;

function cfg(overrides: Partial<Config> = {}): Config {
  return {
    machineName: "desktop",
    botToken: "t",
    allowedUserIds: [1],
    groupChatId: null,
    projectRoots: [],
    projects: {},
    defaultModel: "opus",
    maxConcurrentTurns: 3,
    defaultMachine: "desktop",
    allowYolo: false,
    transcription: null,
    ...overrides,
  };
}

function reg() {
  return registryFrom(
    new Map([
      ["app-A", { name: "app-A", path: "/repos/app-A" }],
      ["bridge", { name: "bridge", path: "/repos/bridge" }],
    ]),
  );
}

function cmd(command: string, args: string, topicId?: number): CommandEvent {
  return { kind: "command", command, args, text: `${command} ${args}`.trim(), senderId: 1, chatId: CHAT, topicId };
}
function msg(text: string, topicId?: number): MessageEvent {
  return { kind: "message", text, senderId: 1, chatId: CHAT, topicId };
}
function voice(topicId?: number): VoiceEvent {
  return {
    kind: "voice",
    audio: new Uint8Array([1, 2, 3]),
    mime: "audio/ogg",
    duration: 2,
    senderId: 1,
    chatId: CHAT,
    topicId,
  };
}

function setup(
  sessions = new FakeSessionFactory(),
  store = new FakeStore(),
  config = cfg(),
  opts: {
    registry?: ReturnType<typeof reg>;
    pathExists?: (p: string) => boolean;
    transcriber?: Transcriber;
    scaffoldProject?: (path: string) => Promise<void>;
  } = {},
) {
  const transport = new FakeTransport();
  const checkpointer = new FakeCheckpointer();
  const registry = opts.registry ?? reg();
  const router = createRouter({
    transport,
    config,
    registry,
    sessions,
    store,
    checkpointer,
    logger: quiet,
    transcriber: opts.transcriber,
    pathExists: opts.pathExists,
    scaffoldProject: opts.scaffoldProject,
  });
  return { transport, router, sessions, store, checkpointer, registry };
}

describe("help", () => {
  it("greets and lists available commands on /start and /help", async () => {
    const { transport, router } = setup();
    await router.handle(cmd("start", ""));
    expect(transport.lastText()).toMatch(/list|new <project>/);
    await router.handle(cmd("help", ""));
    expect(transport.lastText()).toContain("status");
  });
});

describe("list", () => {
  it("shows registered project names", async () => {
    const { transport, router } = setup();
    await router.handle(cmd("list", ""));
    expect(transport.lastText()).toContain("app-A");
    expect(transport.lastText()).toContain("bridge");
  });
});

describe("new", () => {
  it("creates a topic, starts a session at the repo path, and greets in the topic", async () => {
    const { transport, router, sessions } = setup();
    await router.handle(cmd("new", "app-A"));

    expect(transport.topics).toHaveLength(1);
    expect(transport.topics[0]?.name).toBe("app-A");
    expect(sessions.created).toHaveLength(1);
    expect(sessions.created[0]?.cwd).toBe("/repos/app-A");

    const greeting = transport.sent.at(-1);
    expect(greeting?.topicId).toBe(transport.topics[0]?.topicId);
    expect(greeting?.text).toContain("app-A");
  });

  it("resolves names case-insensitively", async () => {
    const { transport, router } = setup();
    await router.handle(cmd("new", "APP-a"));
    expect(transport.topics).toHaveLength(1);
  });

  it("stays silent on a project this machine doesn't have (no topic created)", async () => {
    const { transport, router, sessions } = setup();
    await router.handle(cmd("new", "nope"));
    expect(transport.topics).toHaveLength(0);
    expect(sessions.created).toHaveLength(0);
    expect(transport.sent).toHaveLength(0); // another machine might have it
  });
});

describe("message routing", () => {
  it("feeds a topic message to its session and streams assistant text back", async () => {
    const sessions = new FakeSessionFactory();
    const session = new FakeSession("/repos/app-A");
    session.script([
      { kind: "assistant-text", text: "On it." },
      { kind: "turn-done" },
    ]);
    sessions.prebuild("/repos/app-A", session);

    const { transport, router } = setup(sessions);
    await router.handle(cmd("new", "app-A"));
    const topicId = transport.topics[0]!.topicId;

    await router.handle(msg("fix the bug", topicId));
    await router.idle();

    expect(session.prompts).toContain("fix the bug");
    const texts = transport.sent.filter((s) => s.topicId === topicId).map((s) => s.text);
    expect(texts).toContain("On it.");
  });

  it("hints when a message lands in a topic with no session", async () => {
    const { transport, router } = setup();
    await router.handle(msg("hello", 999));
    expect(transport.lastText()).toContain("No active session");
  });
});

describe("permissions through the router", () => {
  async function startSession(config = cfg()) {
    const sessions = new FakeSessionFactory();
    const session = new FakeSession("/repos/app-A");
    sessions.prebuild("/repos/app-A", session);
    const ctx = setup(sessions, new FakeStore(), config);
    await ctx.router.handle(cmd("new", "app-A"));
    const topicId = ctx.transport.topics[0]!.topicId;
    return { ...ctx, session, topicId };
  }

  it("a mutating tool request posts approval buttons and resolves on Allow", async () => {
    const { transport, router, session, topicId } = await startSession();
    const handler = session.permission!;

    const promise = handler({ tool: "Bash", input: { command: "ls" }, toolUseId: "t1" }, new AbortController().signal);
    const approval = transport.sent.at(-1)!;
    expect(approval.topicId).toBe(topicId);
    expect(approval.buttons).toBeDefined();

    const allowData = approval.buttons![0]!.find((b) => b.data.endsWith("|y"))!.data;
    await router.handle({ kind: "callback", data: allowData, callbackId: "c1", senderId: 1, chatId: CHAT, topicId });

    expect((await promise).allow).toBe(true);
  });

  it("/yolo makes the topic auto-allow without posting buttons (when allowYolo)", async () => {
    const { transport, router, session, topicId } = await startSession(cfg({ allowYolo: true }));
    await router.handle(cmd("yolo", "", topicId));
    const before = transport.sent.length;

    const outcome = await session.permission!(
      { tool: "Bash", input: { command: "ls" }, toolUseId: "t2" },
      new AbortController().signal,
    );
    expect(outcome.allow).toBe(true);
    expect(transport.sent.length).toBe(before); // no approval prompt
  });

  it("/yolo is refused when allowYolo is false (stays tiered, asks on mutation)", async () => {
    const { transport, router, session, topicId } = await startSession(); // default allowYolo: false
    await router.handle(cmd("yolo", "", topicId));
    expect(transport.lastText()).toMatch(/disabled|allowYolo/i);

    // still tiered: a mutating tool posts an approval prompt rather than auto-allowing
    const before = transport.sent.length;
    void session.permission!(
      { tool: "Bash", input: { command: "ls" }, toolUseId: "t3" },
      new AbortController().signal,
    );
    await Promise.resolve();
    expect(transport.sent.length).toBeGreaterThan(before);
    expect(transport.sent.at(-1)!.buttons).toBeDefined();
  });
});

describe("shared-group delegation", () => {
  // A laptop daemon in a shared group: defaultMachine is desktop, so laptop is
  // the secondary (passive until /use laptop).
  function machine(opts: { name: string; registry?: ReturnType<typeof reg>; grace?: number }) {
    const sessions = new FakeSessionFactory();
    const transport = new FakeTransport();
    const router = createRouter({
      transport,
      config: cfg({ machineName: opts.name }),
      registry: opts.registry ?? reg(),
      sessions,
      store: new FakeStore(),
      checkpointer: new FakeCheckpointer(),
      logger: quiet,
      newGraceMs: opts.grace ?? 3000,
    });
    return { transport, router, sessions };
  }

  const laptop = () => machine({ name: "laptop" }); // secondary (defaultMachine=desktop)
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  function bindTopic(router: ReturnType<typeof setup>["router"], name: string, topicId: number) {
    return router.handle({ kind: "topic-created", chatId: CHAT, topicId, name, senderId: 1 });
  }

  it("secondary binds a topic but stays passive by default", async () => {
    const { transport, router, sessions } = laptop();
    await bindTopic(router, "app-A", 10);
    await router.handle(msg("do it", 10));
    await router.idle();
    expect(sessions.created).toHaveLength(0); // laptop didn't act
    expect(transport.sent).toHaveLength(0); // and stayed silent
  });

  it("/use <machine> activates the targeted daemon", async () => {
    const { transport, router, sessions } = laptop();
    await bindTopic(router, "app-A", 10);
    await router.handle(cmd("use", "laptop", 10));
    expect(transport.lastText()).toContain("laptop is now handling");

    await router.handle(msg("do it", 10));
    await router.idle();
    expect(sessions.created).toHaveLength(1); // now laptop acts
  });

  it("secondary defers `new` and binds when the primary creates the topic", async () => {
    const { transport, router } = machine({ name: "laptop", grace: 50 });
    await router.handle(cmd("new", "app-A"));
    expect(transport.topics).toHaveLength(0); // deferred, not created yet

    // Primary created it first: the topic-created cancels our deferred create.
    await bindTopic(router, "app-A", 7);
    await sleep(80); // past the grace
    expect(transport.topics).toHaveLength(0); // laptop never created its own
  });

  it("secondary creates the topic when only it has the project", async () => {
    const registry = registryFrom(new Map([["solo", { name: "solo", path: "/repos/solo" }]]));
    const { transport, router, sessions } = machine({ name: "laptop", registry, grace: 30 });

    await router.handle(cmd("new", "solo"));
    await sleep(60); // grace elapses with no primary topic → laptop creates it
    expect(transport.topics).toHaveLength(1);
    expect(transport.topics[0]?.name).toBe("solo");

    // laptop is the default active machine for a topic it created
    await router.handle(msg("go", transport.topics[0]!.topicId));
    await router.idle();
    expect(sessions.created.length).toBeGreaterThanOrEqual(1);
  });

  it("each machine answers `list` for its own projects, labeled", async () => {
    const registry = registryFrom(new Map([["mobile-app", { name: "mobile-app", path: "/r/mobile-app" }]]));
    const { transport, router } = machine({ name: "laptop", registry });
    await router.handle(cmd("list", ""));
    expect(transport.lastText()).toContain("laptop");
    expect(transport.lastText()).toContain("mobile-app");
  });

  it("a secondary with no projects stays silent on `list`", async () => {
    const { transport, router } = machine({ name: "laptop", registry: registryFrom(new Map()) });
    await router.handle(cmd("list", ""));
    expect(transport.sent).toHaveLength(0);
  });

  it("primary is the active machine by default", async () => {
    const { transport, router, sessions } = setup(); // desktop = primary
    await bindTopic(router, "app-A", 10);
    await router.handle(msg("go", 10));
    await router.idle();
    expect(sessions.created).toHaveLength(1); // desktop acts without /use
    expect(sessions.created[0]?.cwd).toBe("/repos/app-A");
  });
});

describe("persistence", () => {
  it("saves a record when a topic is opened", async () => {
    const { router, store } = setup();
    await router.handle(cmd("new", "app-A"));
    const saved = store.saves.find((r) => r.projectName === "app-A");
    expect(saved).toBeDefined();
    expect(saved?.projectPath).toBe("/repos/app-A");
    expect(saved?.sessionId).toBeNull();
  });

  it("resumes a persisted session by id after a restart", async () => {
    const store = new FakeStore().seed([
      {
        chatId: CHAT,
        topicId: 5,
        projectName: "app-A",
        projectPath: "/repos/app-A",
        sessionId: "sess-1",
        autonomy: "tiered",
        remembered: [],
        model: "opus",
        activeMachine: "desktop",
      },
    ]);
    const sessions = new FakeSessionFactory();
    const { transport, router } = setup(sessions, store);

    await router.handle(msg("continue please", 5));
    await router.idle();

    expect(sessions.createdOpts[0]?.resumeId).toBe("sess-1");
    expect(transport.sent.some((s) => s.text.includes("resumed"))).toBe(true);
  });

  it("heals a moved project's path on startup and persists the new path", async () => {
    const store = new FakeStore().seed([
      {
        chatId: CHAT,
        topicId: 7,
        projectName: "app-A",
        projectPath: "/repos/app-A/app-A", // stale: old double-nested location
        sessionId: "sess-1",
        autonomy: "tiered",
        remembered: [],
        model: "opus",
        activeMachine: "desktop",
      },
    ]);
    // Old path is gone; discovery now resolves app-A to /repos/app-A.
    const pathExists = (p: string) => p === "/repos/app-A";
    const sessions = new FakeSessionFactory();
    const { router } = setup(sessions, store, cfg(), { pathExists });

    // Reconciliation runs during router construction.
    const healed = store.saves.find((r) => r.topicId === 7);
    expect(healed?.projectPath).toBe("/repos/app-A");

    // The resumed session uses the healed path, not the stale one.
    await router.handle(msg("continue", 7));
    await router.idle();
    expect(sessions.createdOpts[0]?.cwd).toBe("/repos/app-A");
  });

  it("leaves a record alone when its saved path still exists", async () => {
    const store = new FakeStore().seed([
      {
        chatId: CHAT,
        topicId: 8,
        projectName: "app-A",
        projectPath: "/repos/app-A",
        sessionId: "sess-1",
        autonomy: "tiered",
        remembered: [],
        model: "opus",
        activeMachine: "desktop",
      },
    ]);
    setup(new FakeSessionFactory(), store, cfg(), { pathExists: () => true });
    expect(store.saves).toHaveLength(0); // nothing to heal, no write
  });

  it("/model updates and persists the topic's model", async () => {
    const { transport, router, store } = setup();
    await router.handle(cmd("new", "app-A"));
    const topicId = transport.topics[0]!.topicId;

    await router.handle(cmd("model", "sonnet", topicId));
    expect(store.saves.at(-1)?.model).toBe("sonnet");
    expect(transport.lastText()).toContain("sonnet");
  });

  it("/concise toggles, persists, and rebuilds the session with the flag", async () => {
    const sessions = new FakeSessionFactory();
    const { transport, router, store } = setup(sessions);
    await router.handle(cmd("new", "app-A"));
    const topicId = transport.topics[0]!.topicId;
    expect(sessions.createdOpts.at(-1)?.concise).toBe(false);

    await router.handle(cmd("concise", "", topicId));
    expect(store.saves.at(-1)?.concise).toBe(true);
    expect(transport.lastText()).toContain("concise mode on");
    // Rebuilt live session carries the flag so the next turn is terse.
    expect(sessions.createdOpts.at(-1)?.concise).toBe(true);

    await router.handle(cmd("concise", "", topicId));
    expect(store.saves.at(-1)?.concise).toBe(false);
    expect(sessions.createdOpts.at(-1)?.concise).toBe(false);

    await router.handle(cmd("concise", "on", topicId));
    expect(store.saves.at(-1)?.concise).toBe(true);
  });

  it("/skill forwards a `/name args` slash command to the session as a turn", async () => {
    const sessions = new FakeSessionFactory();
    const session = new FakeSession("/repos/app-A");
    sessions.prebuild("/repos/app-A", session);
    const { transport, router } = setup(sessions);
    await router.handle(cmd("new", "app-A"));
    const topicId = transport.topics[0]!.topicId;

    await router.handle(cmd("skill", "tdd add a health endpoint", topicId));
    await router.idle();
    expect(session.prompts).toContain("/tdd add a health endpoint");

    // A bare name (and a stray leading slash) normalize to just `/name`.
    await router.handle(cmd("skill", "/grilling", topicId));
    await router.idle();
    expect(session.prompts).toContain("/grilling");
  });

  it("/skill with no name shows usage and runs nothing", async () => {
    const sessions = new FakeSessionFactory();
    const session = new FakeSession("/repos/app-A");
    sessions.prebuild("/repos/app-A", session);
    const { transport, router } = setup(sessions);
    await router.handle(cmd("new", "app-A"));
    const topicId = transport.topics[0]!.topicId;

    await router.handle(cmd("skill", "", topicId));
    await router.idle();
    expect(transport.lastText()).toContain("Usage:");
    expect(session.prompts).toHaveLength(0);
  });

  it("persists a remembered-allow so it survives restart", async () => {
    const sessions = new FakeSessionFactory();
    const session = new FakeSession("/repos/app-A");
    sessions.prebuild("/repos/app-A", session);
    const { transport, router, store } = setup(sessions);

    await router.handle(cmd("new", "app-A"));
    const topicId = transport.topics[0]!.topicId;
    void session.permission!({ tool: "Bash", input: {}, toolUseId: "t1" }, new AbortController().signal);

    const rememberData = transport.sent.at(-1)!.buttons![0]!.find((b) => b.data.endsWith("|r"))!.data;
    await router.handle({ kind: "callback", data: rememberData, callbackId: "c", senderId: 1, chatId: CHAT, topicId });

    expect(store.saves.some((r) => r.remembered.includes("Bash"))).toBe(true);
  });
});

describe("create", () => {
  function withScaffold() {
    const scaffolded: string[] = [];
    const opts = {
      scaffoldProject: async (p: string) => {
        scaffolded.push(p);
      },
      pathExists: () => false,
    };
    return { scaffolded, opts };
  }

  it("scaffolds a new project, registers it live, and opens a topic", async () => {
    const { scaffolded, opts } = withScaffold();
    const { transport, router, store, registry } = setup(
      new FakeSessionFactory(),
      new FakeStore(),
      cfg({ projectRoots: ["/repos"] }),
      opts,
    );

    await router.handle(cmd("create", "fresh-app"));

    expect(scaffolded).toHaveLength(1);
    expect(scaffolded[0]).toMatch(/fresh-app$/);
    expect(registry.resolve("fresh-app")?.name).toBe("fresh-app");
    expect(transport.topics.some((t) => t.name === "fresh-app")).toBe(true);
    expect(store.saves.some((r) => r.projectName === "fresh-app")).toBe(true);
  });

  it("refuses to clobber an existing project", async () => {
    const { scaffolded, opts } = withScaffold();
    const { transport, router } = setup(
      new FakeSessionFactory(),
      new FakeStore(),
      cfg({ projectRoots: ["/repos"] }),
      opts,
    );
    await router.handle(cmd("create", "app-A"));
    expect(transport.lastText()).toContain("already exists");
    expect(scaffolded).toHaveLength(0);
  });

  it("rejects an unsafe project name", async () => {
    const { scaffolded, opts } = withScaffold();
    const { transport, router } = setup(
      new FakeSessionFactory(),
      new FakeStore(),
      cfg({ projectRoots: ["/repos"] }),
      opts,
    );
    await router.handle(cmd("create", "../escape"));
    expect(transport.lastText()).toMatch(/letters, digits/);
    expect(scaffolded).toHaveLength(0);
  });

  it("errors when no projectRoot is configured", async () => {
    const { scaffolded, opts } = withScaffold();
    const { transport, router } = setup(new FakeSessionFactory(), new FakeStore(), cfg(), opts);
    await router.handle(cmd("create", "fresh-app"));
    expect(transport.lastText()).toContain("No projectRoot");
    expect(scaffolded).toHaveLength(0);
  });

  it("honors `on <machine>` and stays silent when another machine is the target", async () => {
    const { scaffolded, opts } = withScaffold();
    const { transport, router, registry } = setup(
      new FakeSessionFactory(),
      new FakeStore(),
      cfg({ projectRoots: ["/repos"] }), // desktop, primary
      opts,
    );

    // Explicit `on desktop` → this (primary) machine creates it.
    await router.handle(cmd("create", "alpha on desktop"));
    expect(registry.resolve("alpha")?.name).toBe("alpha");
    expect(transport.topics.some((t) => t.name === "alpha")).toBe(true);

    // Targeting another machine → this one creates nothing and says nothing.
    const before = scaffolded.length;
    await router.handle(cmd("create", "beta on laptop"));
    expect(scaffolded.length).toBe(before);
    expect(registry.resolve("beta")).toBeUndefined();
  });

  it("a secondary machine creates only when it is the target", async () => {
    const { scaffolded, opts } = withScaffold();
    const { transport, router, registry } = setup(
      new FakeSessionFactory(),
      new FakeStore(),
      cfg({ machineName: "laptop", defaultMachine: "desktop", projectRoots: ["/repos"] }),
      opts,
    );

    // No target → defaults to the primary (desktop) → laptop stays silent.
    await router.handle(cmd("create", "gamma"));
    expect(registry.resolve("gamma")).toBeUndefined();
    expect(scaffolded).toHaveLength(0);

    // Explicit `on laptop` → this machine is the target and creates it.
    await router.handle(cmd("create", "delta on laptop"));
    expect(registry.resolve("delta")?.name).toBe("delta");
    expect(transport.topics.some((t) => t.name === "delta")).toBe(true);
  });
});

describe("voice", () => {
  async function startTopic(transcriber?: Transcriber) {
    const sessions = new FakeSessionFactory();
    const session = new FakeSession("/repos/app-A");
    sessions.prebuild("/repos/app-A", session);
    const ctx = setup(sessions, new FakeStore(), cfg(), { transcriber });
    await ctx.router.handle(cmd("new", "app-A"));
    const topicId = ctx.transport.topics[0]!.topicId;
    return { ...ctx, session, topicId };
  }

  it("transcribes a voice note, echoes it, and runs it as a turn", async () => {
    const transcriber = new FakeTranscriber("add a health endpoint");
    const { transport, router, session, topicId } = await startTopic(transcriber);

    await router.handle(voice(topicId));
    await router.idle();

    expect(transcriber.calls).toHaveLength(1);
    expect(transport.sent.some((s) => s.text.includes("heard: add a health endpoint"))).toBe(true);
    expect(session.prompts).toContain("add a health endpoint");
  });

  it("refuses voice when no transcriber is configured", async () => {
    const { transport, router, session, topicId } = await startTopic(undefined);
    await router.handle(voice(topicId));
    await router.idle();
    expect(transport.lastText()).toContain("Voice isn't set up");
    expect(session.prompts).toHaveLength(0);
  });

  it("reports a transcription failure without running a turn", async () => {
    const transcriber = new FakeTranscriber();
    transcriber.failWith = new Error("STT 401");
    const { transport, router, session, topicId } = await startTopic(transcriber);
    await router.handle(voice(topicId));
    await router.idle();
    expect(transport.lastText()).toContain("Couldn't transcribe");
    expect(session.prompts).toHaveLength(0);
  });
});

describe("notifications", () => {
  async function startWith(events: import("../src/session/types.js").SessionEvent[]) {
    const sessions = new FakeSessionFactory();
    const session = new FakeSession("/repos/app-A");
    session.script(events);
    sessions.prebuild("/repos/app-A", session);
    const ctx = setup(sessions);
    await ctx.router.handle(cmd("new", "app-A"));
    const topicId = ctx.transport.topics[0]!.topicId;
    return { ...ctx, session, topicId };
  }

  it("pings (mentions) on turn completion", async () => {
    const { transport, router, topicId } = await startWith([
      { kind: "assistant-text", text: "done" },
      { kind: "turn-done" },
    ]);
    await router.handle(msg("go", topicId));
    await router.idle();

    const ping = transport.sent.find((s) => s.text.includes("turn complete"));
    expect(ping).toBeDefined();
    expect(ping?.mentionUserIds).toContain(1);
  });

  it("/quiet suppresses the turn-complete ping but not approvals", async () => {
    const { transport, router, session, topicId } = await startWith([
      { kind: "assistant-text", text: "done" },
      { kind: "turn-done" },
    ]);
    await router.handle(cmd("quiet", "", topicId));
    await router.handle(msg("go", topicId));
    await router.idle();
    expect(transport.sent.some((s) => s.text.includes("turn complete"))).toBe(false);

    // approvals still ping
    void session.permission!({ tool: "Bash", input: {}, toolUseId: "t" }, new AbortController().signal);
    expect(transport.sent.at(-1)?.mentionUserIds).toContain(1);
  });

  it("pings on error and skips the turn-complete ping", async () => {
    const { transport, router, topicId } = await startWith([{ kind: "error", message: "boom" }]);
    await router.handle(msg("go", topicId));
    await router.idle();

    const err = transport.sent.find((s) => s.text.includes("boom"));
    expect(err?.mentionUserIds).toContain(1);
    expect(transport.sent.some((s) => s.text.includes("turn complete"))).toBe(false);
  });
});

describe("checkpoint / undo / diff", () => {
  it("checkpoints before each turn and /undo restores the latest", async () => {
    const { transport, router, checkpointer } = setup();
    await router.handle(cmd("new", "app-A"));
    const topicId = transport.topics[0]!.topicId;

    await router.handle(msg("first change", topicId));
    await router.idle();
    await router.handle(msg("second change", topicId));
    await router.idle();
    expect(checkpointer.checkpoints).toHaveLength(2);
    expect(checkpointer.checkpoints[0]?.cwd).toBe("/repos/app-A");

    await router.handle(cmd("undo", "", topicId));
    expect(checkpointer.restores.at(-1)?.id).toBe("cp-2"); // most recent first

    await router.handle(cmd("undo", "", topicId));
    expect(checkpointer.restores.at(-1)?.id).toBe("cp-1");

    await router.handle(cmd("undo", "", topicId));
    expect(transport.lastText()).toContain("Nothing to undo");
  });

  it("/diff summarizes changes since the last checkpoint", async () => {
    const { transport, router } = setup();
    await router.handle(cmd("new", "app-A"));
    const topicId = transport.topics[0]!.topicId;

    await router.handle(cmd("diff", "", topicId));
    expect(transport.lastText()).toContain("No checkpoint yet");

    await router.handle(msg("change it", topicId));
    await router.idle();
    await router.handle(cmd("diff", "", topicId));
    expect(transport.lastText()).toContain("DIFF for cp-1");
  });

  it("rejects /undo outside a project topic", async () => {
    const { transport, router } = setup();
    await router.handle(cmd("undo", ""));
    expect(transport.lastText()).toContain("inside a project topic");
  });
});

describe("concurrency", () => {
  it("queues a mid-turn message and runs it after the current turn (in order)", async () => {
    const sessions = new FakeSessionFactory();
    const session = new FakeSession("/repos/app-A").block(); // first turn holds open
    sessions.prebuild("/repos/app-A", session);
    const { transport, router } = setup(sessions);

    await router.handle(cmd("new", "app-A"));
    const topicId = transport.topics[0]!.topicId;

    await router.handle(msg("first", topicId)); // starts, blocks
    await router.handle(msg("second", topicId)); // should queue
    expect(transport.sent.some((s) => s.text.includes("queued"))).toBe(true);
    expect(session.prompts).toEqual(["first"]); // second hasn't run yet

    session.release();
    await router.idle();
    expect(session.prompts).toEqual(["first", "second"]); // ran in order
  });

  it("/stop aborts the running turn and clears the queue", async () => {
    const sessions = new FakeSessionFactory();
    const session = new FakeSession("/repos/app-A").script([{ kind: "assistant-text", text: "…" }]).block();
    sessions.prebuild("/repos/app-A", session);
    const { transport, router } = setup(sessions);

    await router.handle(cmd("new", "app-A"));
    const topicId = transport.topics[0]!.topicId;

    await router.handle(msg("go", topicId)); // running, blocked
    await router.handle(msg("queued", topicId)); // queued
    await router.handle(cmd("stop", "", topicId));

    expect(session.aborted).toBe(true);
    expect(transport.lastText()).toMatch(/stopped/i);

    session.release();
    await router.idle();
    expect(session.prompts).toEqual(["go"]); // queued message was dropped
  });

  it("caps concurrent turns across topics", async () => {
    const sessions = new FakeSessionFactory();
    const a = new FakeSession("/repos/app-A").block();
    const b = new FakeSession("/repos/bridge").block();
    sessions.prebuild("/repos/app-A", a);
    sessions.prebuild("/repos/bridge", b);
    const { transport, router } = setup(sessions, new FakeStore(), cfg({ maxConcurrentTurns: 1 }));

    await router.handle(cmd("new", "app-A"));
    const topicA = transport.topics[0]!.topicId;
    await router.handle(cmd("new", "bridge"));
    const topicB = transport.topics[1]!.topicId;

    await router.handle(msg("go A", topicA));
    await router.handle(msg("go B", topicB));

    // Only one turn may run with a cap of 1; the other waits on the semaphore.
    expect(a.prompts.length + b.prompts.length).toBe(1);

    a.release();
    b.release();
    await router.idle();
    expect(a.prompts).toEqual(["go A"]);
    expect(b.prompts).toEqual(["go B"]);
  });
});
