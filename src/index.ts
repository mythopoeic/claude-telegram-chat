import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { GitCheckpointer } from "./checkpoint/git.js";
import { loadConfig } from "./config.js";
import { createDaemon } from "./daemon.js";
import { discoverRegistry } from "./registry/discover.js";
import { ClaudeSessionFactory } from "./session/claude.js";
import { JsonStore } from "./store/json.js";
import { TelegramTransport } from "./transport/telegram.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

async function main(): Promise<void> {
  const config = loadConfig();
  const transport = new TelegramTransport(config.botToken);
  const registry = discoverRegistry({ roots: config.projectRoots, overrides: config.projects });
  const sessions = new ClaudeSessionFactory();
  const store = new JsonStore(resolve(repoRoot, "data", "topics.json"));
  const checkpointer = new GitCheckpointer();
  const daemon = createDaemon(transport, config, { registry, sessions, store, checkpointer });

  const shutdown = async (signal: string) => {
    console.log(`\n${signal} received, shutting down…`);
    await daemon.stop();
    process.exit(0);
  };
  process.once("SIGINT", () => void shutdown("SIGINT"));
  process.once("SIGTERM", () => void shutdown("SIGTERM"));

  await daemon.start();
  const projectCount = registry.list().length;
  console.log(
    `telegram-claude-bridge running as "${config.machineName}" — ${config.allowedUserIds.length} allowed user(s), ${projectCount} project(s).`,
  );
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
