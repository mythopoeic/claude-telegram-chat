import { describe, it, expect } from "vitest";
import { createDaemon, type Logger } from "../src/daemon.js";
import { FakeTransport } from "../src/transport/fake.js";
import { FakeSessionFactory } from "../src/session/fake.js";
import { FakeStore } from "../src/store/fake.js";
import { FakeCheckpointer } from "../src/checkpoint/fake.js";
import { registryFrom } from "../src/registry/discover.js";
import type { Config } from "../src/config.js";

const OWNER = 111;
const STRANGER = 222;
const GROUP = -1001234567890;

function makeConfig(overrides: Partial<Config> = {}): Config {
  return {
    machineName: "desktop",
    botToken: "test-token",
    allowedUserIds: [OWNER],
    groupChatId: null,
    projectRoots: [],
    projects: {},
    defaultModel: "opus",
    maxConcurrentTurns: 3,
    defaultMachine: "desktop",
    allowYolo: false,
    ...overrides,
  };
}

const quiet: Logger = { info: () => {}, warn: () => {} };
const emptyRegistry = registryFrom(new Map());

function wire(config: Config) {
  const transport = new FakeTransport();
  const sessions = new FakeSessionFactory();
  createDaemon(transport, config, {
    registry: emptyRegistry,
    sessions,
    store: new FakeStore(),
    checkpointer: new FakeCheckpointer(),
    logger: quiet,
  });
  return { transport, sessions };
}

describe("allowlist", () => {
  it("ignores events from non-allowlisted senders (no reply)", async () => {
    const { transport } = wire(makeConfig());
    await transport.emitText("hello", { senderId: STRANGER, chatId: GROUP });
    expect(transport.sent).toHaveLength(0);
  });

  it("responds to allowlisted senders", async () => {
    const { transport } = wire(makeConfig());
    await transport.emitText("hello", { senderId: OWNER, chatId: GROUP });
    expect(transport.sent).toHaveLength(1);
  });

  it("ignores allowlisted users outside the bound group when groupChatId is set", async () => {
    const { transport } = wire(makeConfig({ groupChatId: GROUP }));
    await transport.emitText("hello", { senderId: OWNER, chatId: 999 });
    expect(transport.sent).toHaveLength(0);

    await transport.emitText("hello", { senderId: OWNER, chatId: GROUP });
    expect(transport.sent).toHaveLength(1);
  });
});

describe("control plane", () => {
  it("guides an unbound top-level message toward new/list", async () => {
    const { transport } = wire(makeConfig());
    await transport.emitText("what now?", { senderId: OWNER, chatId: GROUP });
    expect(transport.lastText()).toMatch(/new <project>|list/i);
  });
});
