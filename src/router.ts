import { existsSync } from "node:fs";
import type { Checkpointer } from "./checkpoint/types.js";
import type { Config } from "./config.js";
import type { Logger } from "./daemon.js";
import { Notifier } from "./notifier.js";
import { PermissionController } from "./permission/controller.js";
import { autonomyFromCommand } from "./permission/policy.js";
import { Semaphore } from "./semaphore.js";
import { createTurnRenderer } from "./render.js";
import type { Registry } from "./registry/types.js";
import type { Session, SessionFactory } from "./session/types.js";
import { recordKey, type Store, type TopicRecord } from "./store/types.js";
import type {
  CallbackEvent,
  CommandEvent,
  InboundEvent,
  MessageEvent,
  Transport,
} from "./transport/types.js";

export interface RouterDeps {
  transport: Transport;
  config: Config;
  registry: Registry;
  sessions: SessionFactory;
  store: Store;
  checkpointer: Checkpointer;
  logger: Logger;
  /** Filesystem existence check; injectable so path-healing is unit-testable. */
  pathExists?: (path: string) => boolean;
  /**
   * Grace a secondary waits on `new` before creating a topic itself, giving the
   * primary first claim (its forum_topic_created cancels the wait). Default 3s.
   */
  newGraceMs?: number;
}

interface Bound {
  session: Session;
  record: TopicRecord;
}

interface Worker {
  items: MessageEvent[];
  running: boolean;
}

export interface Router {
  handle(event: InboundEvent): Promise<void>;
  /** Resolves when all in-flight turns have drained. Test/shutdown helper. */
  idle(): Promise<void>;
}

/**
 * Control plane + routing, with persistence. Records (topic↔session state) load
 * from the store on startup and are saved on every change; live sessions are
 * created lazily — on `new`, or on the first message to a persisted topic after
 * a restart (resumed by session id). Turns within a topic are serialized; full
 * queueing/stop/cap is slice 6.
 */
export function createRouter(deps: RouterDeps): Router {
  const bound = new Map<string, Bound>();
  const records = new Map<string, TopicRecord>();
  const checkpoints = new Map<string, string[]>();
  const workers = new Map<string, Worker>();
  const stopping = new Set<string>();
  const drains = new Set<Promise<void>>();
  const pendingNew = new Map<string, ReturnType<typeof setTimeout>>();
  const newGraceMs = deps.newGraceMs ?? 3000;
  const cap = new Semaphore(deps.config.maxConcurrentTurns);
  const notifier = new Notifier(deps.transport, deps.config.allowedUserIds);
  const permissions = new PermissionController(deps.transport, deps.logger, notifier);
  const pathExists = deps.pathExists ?? existsSync;

  // Machine identity for shared-group delegation. In a single-machine setup
  // defaultMachine === machineName, so this machine is always primary/active.
  const me = deps.config.machineName.toLowerCase();
  const defaultMachine = deps.config.defaultMachine.toLowerCase();
  const isPrimary = me === defaultMachine;

  const key = (chatId: number, topicId?: number) => `${chatId}:${topicId ?? "general"}`;
  const activeMachineFor = (k: string) =>
    (records.get(k)?.activeMachine ?? defaultMachine).toLowerCase();
  const isActive = (k: string) => activeMachineFor(k) === me;

  // Restore persisted state. Sessions resume lazily on the next message.
  for (const record of deps.store.load()) {
    reconcileProjectPath(record);
    record.activeMachine = record.activeMachine ?? deps.config.defaultMachine;
    const k = recordKey(record.chatId, record.topicId);
    records.set(k, record);
    permissions.restore(k, record.autonomy, record.remembered);
  }

  /**
   * Heal a topic whose project moved on disk. If the saved path is gone but
   * discovery now resolves the same project name to a different, existing path,
   * adopt it and persist — so a moved or un-nested repo (e.g. fixing a
   * double-nested clone) keeps working without hand-editing the saved state.
   * Logged so the change is visible in the daemon log.
   *
   * Note: this can only heal *discovered* projects (those found under a
   * configured projectRoot). A project pinned via a `projects` override in
   * config.json resolves to whatever that override says, so a stale override
   * still has to be fixed by hand.
   */
  function reconcileProjectPath(record: TopicRecord): void {
    if (pathExists(record.projectPath)) return;
    const project = deps.registry.resolve(record.projectName);
    if (!project || project.path === record.projectPath || !pathExists(project.path)) {
      return;
    }
    deps.logger.info(
      `project "${record.projectName}" moved: ${record.projectPath} → ${project.path}; updating saved path.`,
    );
    record.projectPath = project.path;
    deps.store.save(record);
  }

  // Persist autonomy/remembered changes coming from the permission controller.
  permissions.setOnChange((k, autonomy, remembered) => {
    const record = records.get(k);
    if (!record) return;
    record.autonomy = autonomy;
    record.remembered = remembered;
    deps.store.save(record);
  });

  async function handle(event: InboundEvent): Promise<void> {
    if (event.kind === "topic-created") return handleTopicCreated(event);
    // Delegation gate: in a shared group, only the right daemon acts.
    if (!shouldHandle(event)) return;
    switch (event.kind) {
      case "command":
        return handleCommand(event);
      case "message":
        return handleMessage(event);
      case "callback":
        return handleCallback(event);
    }
  }

  /**
   * Whether THIS daemon should act on a user event, given shared-group roles:
   * - `/use` is observed by everyone (so all daemons agree on the active one).
   * - control-plane commands/messages (General topic) → primary only, so a
   *   shared group doesn't get double replies.
   * - anything in a project topic → only the topic's active machine.
   */
  function shouldHandle(event: CommandEvent | MessageEvent | CallbackEvent): boolean {
    if (event.kind === "command") {
      // Every machine observes these: /use (so they agree on the active one),
      // and list/new (each machine answers for its OWN projects).
      if (event.command === "use" || event.command === "list" || event.command === "new") {
        return true;
      }
    }
    if (event.topicId === undefined) return isPrimary;
    return isActive(key(event.chatId, event.topicId));
  }

  /** Bind a newly-created topic to this machine's matching project (by name). */
  async function handleTopicCreated(event: { chatId: number; topicId: number; name: string }): Promise<void> {
    // A topic for this project now exists; cancel any deferred `new` we queued.
    const nameKey = event.name.toLowerCase();
    const pending = pendingNew.get(nameKey);
    if (pending) {
      clearTimeout(pending);
      pendingNew.delete(nameKey);
    }

    const k = key(event.chatId, event.topicId);
    if (records.has(k)) return; // already bound (e.g. this machine created it via `new`)
    const project = deps.registry.resolve(event.name);
    if (!project) return; // this machine doesn't have that project — nothing to bind

    const record: TopicRecord = {
      chatId: event.chatId,
      topicId: event.topicId,
      projectName: project.name,
      projectPath: project.path,
      sessionId: null,
      autonomy: "tiered",
      remembered: [],
      model: deps.config.defaultModel,
      activeMachine: deps.config.defaultMachine,
    };
    records.set(k, record);
    deps.store.save(record);
    permissions.restore(k, record.autonomy, record.remembered);
    deps.logger.info(`bound topic "${event.name}" → ${project.path}`);
  }

  function handleCallback(event: CallbackEvent): void {
    if (!permissions.resolveCallback(event.data)) {
      deps.logger.warn(`unmatched callback: ${event.data}`);
    }
  }

  async function handleCommand(event: CommandEvent): Promise<void> {
    switch (event.command) {
      case "start":
      case "help":
        return reply(event, helpText());
      case "list":
        return handleList(event);
      case "new":
        return handleNew(event);
      case "status":
        return reply(event, formatStatus());
      case "model":
        return handleModel(event);
      case "quiet":
        return handleQuiet(event);
      case "use":
        return handleUse(event);
      case "stop":
        return handleStop(event);
      case "undo":
        return handleUndo(event);
      case "diff":
        return handleDiff(event);
      case "yolo":
      case "careful":
      case "tiered":
      case "auto":
        return handleAutonomy(event);
      default:
        return reply(event, `\`${event.command}\` isn't available yet — it lands in a later slice.`);
    }
  }

  async function handleAutonomy(event: CommandEvent): Promise<void> {
    const autonomy = autonomyFromCommand(event.command);
    if (!autonomy) return;
    if (autonomy === "yolo" && !deps.config.allowYolo) {
      await reply(
        event,
        "`/yolo` is disabled on this machine. Set `\"allowYolo\": true` in config.json to enable unattended auto-approval. Staying on tiered approvals.",
      );
      return;
    }
    permissions.setMode(key(event.chatId, event.topicId), autonomy);
    const blurb =
      autonomy === "yolo"
        ? "auto-approving everything in this topic. Use /careful or /tiered to dial back."
        : autonomy === "careful"
          ? "asking before every tool, including reads."
          : "tiered approvals — safe reads run, mutations ask.";
    await reply(event, `Autonomy: ${autonomy} — ${blurb}`);
  }

  /**
   * Delegate a topic to a machine. Every daemon observes this and updates its
   * own view (so they agree on who's active); only the targeted machine — if
   * it has the project bound — replies. With no argument, the active machine
   * reports who's currently handling the topic.
   */
  async function handleUse(event: CommandEvent): Promise<void> {
    if (event.topicId === undefined) {
      if (isPrimary) await reply(event, "Use `/use <machine>` inside a project topic.");
      return;
    }
    const k = key(event.chatId, event.topicId);
    const record = records.get(k);
    if (!record) return; // this machine doesn't have this topic — stay silent

    const target = event.args.trim().toLowerCase();
    if (!target) {
      if (isActive(k)) await reply(event, `This topic is handled by *${record.activeMachine}*.`);
      return;
    }

    record.activeMachine = target;
    deps.store.save(record);
    if (target === me) {
      await reply(event, `✅ ${deps.config.machineName} is now handling this topic.`);
    }
  }

  async function handleStop(event: CommandEvent): Promise<void> {
    const k = key(event.chatId, event.topicId);
    const worker = workers.get(k);
    const b = bound.get(k);

    const dropped = worker?.items.length ?? 0;
    if (worker) worker.items.length = 0; // clear the queue

    const running = worker?.running ?? false;
    if (running && b) {
      stopping.add(k); // suppress the turn-complete ping for the aborted turn
      b.session.abort();
    }

    if (running || dropped > 0) {
      const queued = dropped > 0 ? ` and cleared ${dropped} queued message(s)` : "";
      await reply(event, `🛑 stopped the current turn${queued}.`);
    } else {
      await reply(event, "Nothing to stop here.");
    }
  }

  async function handleUndo(event: CommandEvent): Promise<void> {
    const k = key(event.chatId, event.topicId);
    const record = records.get(k);
    if (!record) return reply(event, "Use `/undo` inside a project topic.");

    const stack = checkpoints.get(k);
    const checkpoint = stack?.pop();
    if (!checkpoint) return reply(event, "Nothing to undo — no checkpoint since the last turn.");

    try {
      await deps.checkpointer.restore(record.projectPath, checkpoint);
      await reply(event, "↩️ undone — working tree restored to before the last turn.");
    } catch (err) {
      stack?.push(checkpoint); // restore failed; keep it available
      await reply(event, `Undo failed: ${(err as Error).message}`);
    }
  }

  async function handleDiff(event: CommandEvent): Promise<void> {
    const k = key(event.chatId, event.topicId);
    const record = records.get(k);
    if (!record) return reply(event, "Use `/diff` inside a project topic.");

    const checkpoint = checkpoints.get(k)?.at(-1);
    if (!checkpoint) return reply(event, "No checkpoint yet — send a message to start a turn first.");

    const summary = await deps.checkpointer.diff(record.projectPath, checkpoint);
    await reply(event, `Changes since the last turn:\n${summary.slice(0, 3500)}`);
  }

  async function handleQuiet(event: CommandEvent): Promise<void> {
    const k = key(event.chatId, event.topicId);
    const arg = event.args.trim().toLowerCase();
    let on: boolean;
    if (arg === "on") {
      notifier.setQuiet(k, true);
      on = true;
    } else if (arg === "off") {
      notifier.setQuiet(k, false);
      on = false;
    } else {
      on = notifier.toggleQuiet(k);
    }
    await reply(
      event,
      on
        ? "🔕 quiet — turn-complete pings off here (approvals and errors still ping)."
        : "🔔 pings on for this topic.",
    );
  }

  async function handleModel(event: CommandEvent): Promise<void> {
    if (event.topicId === undefined) {
      return reply(event, "Use `/model` inside a project topic.");
    }
    const topicId = event.topicId;
    const k = key(event.chatId, topicId);
    const record = records.get(k);
    if (!record) {
      return reply(event, "Use `/model` inside a project topic.");
    }
    const model = event.args.trim();
    if (!model) {
      return reply(event, `Model for this topic: ${record.model}. Set with \`/model <name>\`.`);
    }
    record.model = model;
    deps.store.save(record);
    // Rebuild the live session (if any) so the new model takes effect, resuming
    // the same conversation by id.
    if (bound.has(k)) bound.set(k, resume(record, event.chatId, topicId));
    await reply(event, `Model set to ${model} for this topic.`);
  }

  function helpText(): string {
    return [
      `*${deps.config.machineName}* bridge — direct Claude on this machine.`,
      "",
      "Available now:",
      "• `list` — show registered projects",
      "• `new <project>` — open a topic and start a session",
      "• `status` — show active sessions, autonomy, and model",
      "• `/model <name>` — set this topic's model",
      "• `/yolo` · `/careful` · `/tiered` — set a topic's approval mode",
      "• `/use <machine>` — choose which machine handles this topic",
      "• `/quiet` — mute turn-complete pings for this topic",
      "• `/stop` — abort the current turn and clear the queue",
      "• `/undo` · `/diff` — rewind / inspect the last turn's changes",
      "• `help` — this message",
      "",
      "Messages mid-turn queue; turns across topics run in parallel.",
      "You're pinged on approvals, turn completion, and errors.",
      "Each turn is checkpointed; /undo rewinds it. Sessions resume after restart.",
    ].join("\n");
  }

  /**
   * Each machine answers `list` for its OWN projects, labeled by machine, so a
   * shared group shows what's available on both. A machine with no projects
   * stays silent (except the primary, which gives the setup hint).
   */
  async function handleList(event: CommandEvent): Promise<void> {
    const projects = deps.registry.list();
    if (projects.length === 0) {
      if (isPrimary) {
        await reply(
          event,
          "No projects registered. Add a git repo under a configured projectRoot, or set one in config.json.",
        );
      }
      return;
    }
    await reply(
      event,
      `*${deps.config.machineName}* projects:\n${projects.map((p) => `• ${p.name}`).join("\n")}`,
    );
  }

  function formatStatus(): string {
    if (records.size === 0) return "No sessions.";
    const lines = [...records.entries()].map(([k, r]) => {
      const live = bound.has(k) ? "live" : "idle";
      return `• ${r.projectName} — →${r.activeMachine}, ${permissions.mode(k)}, ${r.model} (${live})`;
    });
    return `Sessions:\n${lines.join("\n")}`;
  }

  /**
   * `new <project>` is created by whichever machine HAS the project. A machine
   * that lacks it stays silent (another may have it). When both have it the
   * primary wins: it creates immediately, while a secondary defers briefly and
   * binds to the primary's topic instead (its forum_topic_created cancels the
   * deferred create). If only the secondary has it, the defer elapses and the
   * secondary creates the topic — becoming the default machine there.
   */
  async function handleNew(event: CommandEvent): Promise<void> {
    const name = event.args.trim();
    if (!name) {
      if (isPrimary) await reply(event, "Usage: `new <project>` — try `list` to see names.");
      return;
    }

    const project = deps.registry.resolve(name);
    if (!project) return; // not on this machine — stay silent

    if (isPrimary) {
      await createTopicFor(event.chatId, project);
      return;
    }

    const nameKey = project.name.toLowerCase();
    if (pendingNew.has(nameKey)) return;
    const timer = setTimeout(() => {
      pendingNew.delete(nameKey);
      void createTopicFor(event.chatId, project).catch((err) =>
        deps.logger.warn(`deferred new failed: ${(err as Error).message}`),
      );
    }, newGraceMs);
    timer.unref?.();
    pendingNew.set(nameKey, timer);
  }

  /** Create a topic for a project on THIS machine and bind it as the creator. */
  async function createTopicFor(
    chatId: number,
    project: { name: string; path: string },
  ): Promise<void> {
    let topicId: number;
    try {
      topicId = (await deps.transport.createTopic(chatId, project.name)).topicId;
    } catch (err) {
      deps.logger.warn(`createTopic failed: ${(err as Error).message}`);
      await deps.transport.send({
        chatId,
        text: `Couldn't create a topic for "${project.name}". The bot must be an admin of a forum-enabled supergroup.`,
      });
      return;
    }

    const k = key(chatId, topicId);
    const record: TopicRecord = {
      chatId,
      topicId,
      projectName: project.name,
      projectPath: project.path,
      sessionId: null,
      autonomy: "tiered",
      remembered: [],
      model: deps.config.defaultModel,
      activeMachine: deps.config.machineName, // the creator handles it by default
    };
    records.set(k, record);
    deps.store.save(record);
    bound.set(k, resume(record, chatId, topicId));

    await deps.transport.send({
      chatId,
      topicId,
      text: `Started a session for ${project.name} on ${deps.config.machineName}\n${project.path}\nSend a message to begin. Mutations ask for approval; /yolo to run unattended, /careful to approve everything.`,
    });
  }

  /** Build a live Bound for a record, resuming the SDK session if known. */
  function resume(record: TopicRecord, chatId: number, topicId: number): Bound {
    const session = deps.sessions.create({
      cwd: record.projectPath,
      model: record.model,
      resumeId: record.sessionId ?? undefined,
      permission: permissions.handlerFor(chatId, topicId, recordKey(chatId, topicId)),
    });
    return { session, record };
  }

  async function handleMessage(event: MessageEvent): Promise<void> {
    if (event.topicId === undefined) {
      return reply(event, "This is the control plane. Use `new <project>` to start, or `list`.");
    }
    const k = key(event.chatId, event.topicId);

    if (!bound.has(k)) {
      const record = records.get(k);
      if (!record) {
        return reply(event, "No active session in this topic. Use `new <project>` in General.");
      }
      bound.set(k, resume(record, event.chatId, event.topicId));
      await reply(event, `↩️ resumed session for ${record.projectName}.`);
    }

    enqueue(k, event);
  }

  /**
   * Queue a message for its topic and kick the background worker. Turns within a
   * topic run one at a time (later messages queue); turns across topics run
   * concurrently up to the cap. Crucially, we do NOT await the turn here — a
   * turn can pause indefinitely on an approval, and blocking the event handler
   * would stop the daemon from ever receiving the button press that frees it.
   */
  function enqueue(k: string, event: MessageEvent): void {
    let worker = workers.get(k);
    if (!worker) {
      worker = { items: [], running: false };
      workers.set(k, worker);
    }
    if (worker.running) {
      void reply(event, "⏳ queued — runs after the current turn.");
    }
    worker.items.push(event);
    if (!worker.running) startDrain(k);
  }

  function startDrain(k: string): void {
    const promise = drain(k).finally(() => drains.delete(promise));
    drains.add(promise);
  }

  async function drain(k: string): Promise<void> {
    const worker = workers.get(k);
    if (!worker || worker.running) return;
    worker.running = true;
    try {
      while (worker.items.length > 0) {
        const event = worker.items.shift()!;
        const b = bound.get(k);
        if (!b) continue;
        await cap.acquire();
        try {
          await runTurn(event, b, k);
        } catch (err) {
          deps.logger.warn(`turn failed: ${(err as Error).message}`);
        } finally {
          cap.release();
        }
      }
    } finally {
      worker.running = false;
    }
  }

  async function idle(): Promise<void> {
    while (drains.size > 0) await Promise.all([...drains]);
  }

  async function runTurn(event: MessageEvent, b: Bound, k: string): Promise<void> {
    // Snapshot before the turn so a bad turn is one /undo away.
    try {
      const checkpoint = await deps.checkpointer.checkpoint(b.record.projectPath);
      if (checkpoint) {
        const stack = checkpoints.get(k) ?? [];
        stack.push(checkpoint);
        checkpoints.set(k, stack);
      }
    } catch (err) {
      deps.logger.warn(`checkpoint failed: ${(err as Error).message}`);
    }

    const renderer = createTurnRenderer(deps.transport, event.chatId, event.topicId);
    let sawError = false;
    for await (const ev of b.session.send(event.text)) {
      if (ev.kind === "error") {
        sawError = true;
        await notifier.error(event.chatId, event.topicId, ev.message);
        continue;
      }
      await renderer.handle(ev);
    }
    // Capture the SDK session id once known so the topic resumes after restart.
    if (b.session.id && b.session.id !== b.record.sessionId) {
      b.record.sessionId = b.session.id;
      deps.store.save(b.record);
    }
    if (stopping.delete(k)) return; // aborted via /stop: no "your move" ping
    if (!sawError) await notifier.turnComplete(event.chatId, event.topicId, k);
  }

  function reply(event: InboundEvent, text: string): Promise<void> {
    return deps.transport
      .send({ chatId: event.chatId, topicId: event.topicId, text })
      .then(() => undefined);
  }

  return { handle, idle };
}
