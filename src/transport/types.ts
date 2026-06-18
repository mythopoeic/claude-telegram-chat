/**
 * The Transport seam: the only place the rest of the daemon touches Telegram.
 *
 * Inbound updates are normalized into InboundEvent; outbound actions go through
 * a small, platform-agnostic surface. Every later slice (sessions, permissions,
 * rendering, notifications) is written against this interface and tested with a
 * fake implementation, so no test ever talks to real Telegram.
 */

export type InboundEvent =
  | MessageEvent
  | CommandEvent
  | CallbackEvent
  | VoiceEvent
  | TopicCreatedEvent;

interface BaseEvent {
  /** Telegram user id of the sender. Checked against the allowlist. */
  senderId: number;
  /** Group/chat id the event came from. */
  chatId: number;
  /**
   * Forum topic id (Telegram message_thread_id). Undefined means the General
   * topic / a non-forum chat — treated as the control plane.
   */
  topicId?: number;
  /** Original platform payload, for escape hatches. Avoid relying on its shape. */
  raw?: unknown;
}

/** A plain text message (the common case — feeds a project session later). */
export interface MessageEvent extends BaseEvent {
  kind: "message";
  text: string;
}

/** A slash- or word-command like `/stop`, `list`, `new app-A`. */
export interface CommandEvent extends BaseEvent {
  kind: "command";
  /** Command name without any leading slash, lowercased (e.g. "new", "stop"). */
  command: string;
  /** Everything after the command name, trimmed (e.g. "app-A"). */
  args: string;
  /** The full original text, for logging/echo. */
  text: string;
}

/**
 * A voice note (or uploaded audio). The transport downloads the audio bytes;
 * the router transcribes them and runs the text as a normal turn. Carries the
 * bytes rather than a file id so the transcriber stays platform-agnostic.
 */
export interface VoiceEvent extends BaseEvent {
  kind: "voice";
  /** Raw audio bytes (OGG/Opus for Telegram voice notes). */
  audio: Uint8Array;
  /** Source content type, e.g. "audio/ogg". */
  mime: string;
  /** Clip length in seconds, for logging/UX. */
  duration: number;
}

/** An inline-button press (used by the permission slice). */
export interface CallbackEvent extends BaseEvent {
  kind: "callback";
  /** Opaque data string attached to the pressed button. */
  data: string;
  /** Id Telegram needs to acknowledge the press. */
  callbackId: string;
}

/**
 * A forum topic was created in the group. Both daemons in a shared group see
 * this and bind the topic to their local project by name. Not user-driven, so
 * it bypasses the allowlist.
 */
export interface TopicCreatedEvent extends BaseEvent {
  kind: "topic-created";
  /** A created topic always has a thread id. */
  topicId: number;
  /** The topic's title (used to resolve the project). */
  name: string;
}

/** An inline button: a label plus opaque callback data (≤64 bytes). */
export interface Button {
  text: string;
  data: string;
}

export interface OutboundMessage {
  chatId: number;
  topicId?: number;
  text: string;
  /** Optional inline keyboard, as rows of buttons. */
  buttons?: Button[][];
  /** User ids to @-mention (fires a mobile push). Rendered as invisible mentions. */
  mentionUserIds?: number[];
}

export interface SentMessage {
  messageId: number;
}

export type EventHandler = (event: InboundEvent) => void | Promise<void>;

export interface Transport {
  /** Register the single handler that receives all normalized inbound events. */
  onEvent(handler: EventHandler): void;
  /** Send a message into a chat/topic. */
  send(message: OutboundMessage): Promise<SentMessage>;
  /**
   * Edit a previously sent message's text in place (and drop any inline
   * keyboard). Used for the live "working…" line and to finalize approvals.
   */
  edit(chatId: number, messageId: number, text: string): Promise<void>;
  /**
   * Create a forum topic in a supergroup and return its id. Used by `new
   * <project>` to give each project its own topic/session.
   */
  createTopic(chatId: number, name: string): Promise<{ topicId: number }>;
  /** Begin receiving events (e.g. start long-polling). Resolves once running. */
  start(): Promise<void>;
  /** Stop receiving events and release resources. */
  stop(): Promise<void>;
}

/** Set of command names the control plane recognizes (extended in later slices). */
const KNOWN_WORD_COMMANDS = new Set(["list", "new", "create", "status"]);

/**
 * Normalizes a raw text + metadata into a MessageEvent or CommandEvent.
 * Shared by the real transport and tests so command parsing has one definition.
 *
 * A leading `/` always marks a command (and a `/cmd@botname` suffix is stripped).
 * A bare first word in KNOWN_WORD_COMMANDS is also treated as a command, so
 * `list` works without a slash from a phone.
 */
export function parseText(
  text: string,
  meta: { senderId: number; chatId: number; topicId?: number; raw?: unknown },
): MessageEvent | CommandEvent {
  const trimmed = text.trim();
  const firstWord = trimmed.split(/\s+/, 1)[0] ?? "";

  const isSlash = firstWord.startsWith("/");
  const bareName = firstWord.toLowerCase();
  const isKnownWord = KNOWN_WORD_COMMANDS.has(bareName);

  if (isSlash || isKnownWord) {
    let name = isSlash ? firstWord.slice(1) : firstWord;
    // strip @botname mention that Telegram appends in groups
    const at = name.indexOf("@");
    if (at !== -1) name = name.slice(0, at);
    const args = trimmed.slice(firstWord.length).trim();
    return {
      kind: "command",
      command: name.toLowerCase(),
      args,
      text: trimmed,
      ...meta,
    };
  }

  return { kind: "message", text: trimmed, ...meta };
}
