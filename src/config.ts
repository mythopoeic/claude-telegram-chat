import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..");

/** Speech-to-text settings for voice notes. Absent/keyless → voice disabled. */
export interface TranscriptionConfig {
  /** Bearer token for the OpenAI-compatible STT endpoint (e.g. a Groq key). */
  apiKey: string;
  /** Base URL of the provider (default Groq's OpenAI-compatible endpoint). */
  baseUrl: string;
  /** Model id (default Groq's whisper-large-v3-turbo). */
  model: string;
}

export interface Config {
  /** Human label for this machine, used in messages (e.g. "desktop"). */
  machineName: string;
  /** Telegram bot token from BotFather. */
  botToken: string;
  /** Telegram user ids permitted to drive this daemon. Everyone else is ignored. */
  allowedUserIds: number[];
  /**
   * Optional: restrict the bot to a single supergroup (this machine's group).
   * If null, the bot responds in any chat an allowlisted user messages from.
   */
  groupChatId: number | null;
  /** Directories scanned for git repos to auto-register as projects. */
  projectRoots: string[];
  /** Hand-specified name→path projects, layered over (and winning) discovery. */
  projects: Record<string, string>;
  /** Default model alias/id for new sessions (e.g. "opus", "sonnet"). */
  defaultModel: string;
  /** Max turns running concurrently across all topics on this machine. */
  maxConcurrentTurns: number;
  /**
   * Whether `/yolo` (auto-approve every tool, unattended) may be enabled on a
   * topic. Defaults to false: the bypass is refused unless explicitly opted in,
   * so a fresh install can never silently run unsupervised. tiered/careful are
   * always available regardless.
   */
  allowYolo: boolean;
  /**
   * Name of the primary machine in a shared group: it owns topic creation and is
   * the default active machine. Set the SAME value on every machine sharing a
   * group. Defaults to this machine's own name (single-machine setups are then
   * always primary/active, unchanged).
   */
  defaultMachine: string;
  /**
   * Speech-to-text for Telegram voice notes. Null when not configured (or the
   * key is still a placeholder) — voice messages then get a "not configured"
   * reply instead of failing the daemon at boot.
   */
  transcription: TranscriptionConfig | null;
}

/**
 * Loads and validates config.json from the repo root. Throws a actionable
 * error pointing at config.example.json when the file is missing or invalid,
 * so a fresh checkout fails loudly rather than silently misbehaving.
 */
export function loadConfig(path = resolve(repoRoot, "config.json")): Config {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    throw new Error(
      `Missing config at ${path}. Copy config.example.json to config.json and fill in your bot token and allowed user ids.`,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`config.json is not valid JSON: ${(err as Error).message}`);
  }

  return validateConfig(parsed);
}

/** Pure validator — exported so tests can exercise it without touching disk. */
export function validateConfig(parsed: unknown): Config {
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("config.json must be a JSON object");
  }
  const o = parsed as Record<string, unknown>;

  const machineName = o.machineName;
  if (typeof machineName !== "string" || machineName.length === 0) {
    throw new Error('config.machineName must be a non-empty string (e.g. "desktop")');
  }

  const botToken = o.botToken;
  if (typeof botToken !== "string" || botToken.length === 0 || botToken.startsWith("PASTE_")) {
    throw new Error("config.botToken must be set to your real BotFather token");
  }

  const allowedUserIds = o.allowedUserIds;
  if (
    !Array.isArray(allowedUserIds) ||
    allowedUserIds.length === 0 ||
    !allowedUserIds.every((id) => typeof id === "number" && Number.isInteger(id))
  ) {
    throw new Error("config.allowedUserIds must be a non-empty array of integer Telegram user ids");
  }

  const groupChatId = o.groupChatId ?? null;
  if (groupChatId !== null && !(typeof groupChatId === "number" && Number.isInteger(groupChatId))) {
    throw new Error("config.groupChatId must be an integer chat id or null");
  }

  const projectRoots = o.projectRoots ?? [];
  if (!Array.isArray(projectRoots) || !projectRoots.every((p) => typeof p === "string")) {
    throw new Error("config.projectRoots must be an array of directory paths");
  }

  const projects = o.projects ?? {};
  if (
    typeof projects !== "object" ||
    projects === null ||
    Array.isArray(projects) ||
    !Object.values(projects).every((v) => typeof v === "string")
  ) {
    throw new Error("config.projects must be an object mapping name → path");
  }

  const defaultModel = o.defaultModel ?? "opus";
  if (typeof defaultModel !== "string" || defaultModel.length === 0) {
    throw new Error("config.defaultModel must be a non-empty string");
  }

  const maxConcurrentTurns = o.maxConcurrentTurns ?? 3;
  if (
    typeof maxConcurrentTurns !== "number" ||
    !Number.isInteger(maxConcurrentTurns) ||
    maxConcurrentTurns < 1
  ) {
    throw new Error("config.maxConcurrentTurns must be a positive integer");
  }

  const defaultMachine = o.defaultMachine ?? machineName;
  if (typeof defaultMachine !== "string" || defaultMachine.length === 0) {
    throw new Error("config.defaultMachine must be a non-empty string");
  }

  const allowYolo = o.allowYolo ?? false;
  if (typeof allowYolo !== "boolean") {
    throw new Error("config.allowYolo must be a boolean");
  }

  const transcription = parseTranscription(o.transcription);

  return {
    machineName,
    botToken,
    allowedUserIds: allowedUserIds as number[],
    groupChatId,
    projectRoots: projectRoots as string[],
    projects: projects as Record<string, string>,
    defaultModel,
    maxConcurrentTurns,
    defaultMachine,
    allowYolo,
    transcription,
  };
}

/**
 * Parse the optional transcription block. A missing block, or one whose apiKey
 * is empty or still the placeholder, yields null (voice disabled) rather than a
 * hard error — so a fresh config without a Groq key still boots. baseUrl/model
 * default to Groq's OpenAI-compatible Whisper endpoint.
 */
function parseTranscription(raw: unknown): TranscriptionConfig | null {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("config.transcription must be an object or null");
  }
  const t = raw as Record<string, unknown>;

  const apiKey = t.apiKey;
  if (typeof apiKey !== "string" || apiKey.length === 0 || apiKey.startsWith("PASTE_")) {
    return null; // not configured yet — voice stays off, daemon still boots
  }

  const baseUrl = t.baseUrl ?? "https://api.groq.com/openai/v1";
  if (typeof baseUrl !== "string" || baseUrl.length === 0) {
    throw new Error("config.transcription.baseUrl must be a non-empty string");
  }

  const model = t.model ?? "whisper-large-v3-turbo";
  if (typeof model !== "string" || model.length === 0) {
    throw new Error("config.transcription.model must be a non-empty string");
  }

  return { apiKey, baseUrl, model };
}
