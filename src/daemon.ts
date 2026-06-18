import type { Checkpointer } from "./checkpoint/types.js";
import type { Config } from "./config.js";
import type { Registry } from "./registry/types.js";
import { createRouter } from "./router.js";
import type { SessionFactory } from "./session/types.js";
import type { Store } from "./store/types.js";
import type { InboundEvent, Transport } from "./transport/types.js";

export interface Logger {
  info(msg: string): void;
  warn(msg: string): void;
}

const consoleLogger: Logger = {
  info: (m) => console.log(m),
  warn: (m) => console.warn(m),
};

export interface DaemonDeps {
  registry: Registry;
  sessions: SessionFactory;
  store: Store;
  checkpointer: Checkpointer;
  logger?: Logger;
}

export interface Daemon {
  /** Start the underlying transport (begins receiving events). */
  start(): Promise<void>;
  stop(): Promise<void>;
}

/**
 * Wires a Transport to the core policy: enforce the user-id allowlist on every
 * inbound event, then hand authorized events to the router (registry, sessions,
 * project topics). Unauthorized senders are silently ignored (logged locally).
 */
export function createDaemon(transport: Transport, config: Config, deps: DaemonDeps): Daemon {
  const logger = deps.logger ?? consoleLogger;
  const router = createRouter({
    transport,
    config,
    registry: deps.registry,
    sessions: deps.sessions,
    store: deps.store,
    checkpointer: deps.checkpointer,
    logger,
  });

  transport.onEvent(async (event) => {
    // topic-created is a system event (the sender is a bot), so it bypasses the
    // user allowlist — it only binds a topic to a project, nothing executable.
    if (event.kind !== "topic-created" && !isAuthorized(event, config)) {
      logger.warn(
        `ignored event from unauthorized sender ${event.senderId} in chat ${event.chatId}`,
      );
      return;
    }
    await router.handle(event);
  });

  return {
    start: () => transport.start(),
    stop: () => transport.stop(),
  };
}

/** True only if the sender is allowlisted and (if configured) in the bound group. */
function isAuthorized(event: InboundEvent, config: Config): boolean {
  if (!config.allowedUserIds.includes(event.senderId)) return false;
  if (config.groupChatId !== null && event.chatId !== config.groupChatId) return false;
  return true;
}
