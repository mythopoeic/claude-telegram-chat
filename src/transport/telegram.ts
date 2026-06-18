import { Bot, InlineKeyboard } from "grammy";
import type { MessageEntity } from "grammy/types";
import { autoRetry } from "@grammyjs/auto-retry";
import {
  parseText,
  type Button,
  type EventHandler,
  type OutboundMessage,
  type SentMessage,
  type Transport,
} from "./types.js";

/**
 * grammY-backed Telegram transport using long-polling (getUpdates) — outbound
 * only, so it works from behind a home NAT with no public URL or app token.
 */
export class TelegramTransport implements Transport {
  private readonly bot: Bot;
  private handler: EventHandler | null = null;
  private runningPromise: Promise<void> | null = null;
  private stopping = false;

  constructor(botToken: string) {
    this.bot = new Bot(botToken);
    // Transparently honor Telegram's retry_after on 429s instead of failing the
    // call. Belt-and-suspenders alongside the renderer's edit throttling.
    this.bot.api.config.use(autoRetry({ maxRetryAttempts: 5, maxDelaySeconds: 60 }));
    this.registerHandlers();
  }

  onEvent(handler: EventHandler): void {
    this.handler = handler;
  }

  async send(message: OutboundMessage): Promise<SentMessage> {
    const { text, entities } = withMentions(message.text, message.mentionUserIds);
    const sent = await this.bot.api.sendMessage(message.chatId, text, {
      ...(message.topicId !== undefined ? { message_thread_id: message.topicId } : {}),
      ...(message.buttons ? { reply_markup: toKeyboard(message.buttons) } : {}),
      ...(entities.length ? { entities } : {}),
    });
    return { messageId: sent.message_id };
  }

  async edit(chatId: number, messageId: number, text: string): Promise<void> {
    // No reply_markup → Telegram drops the inline keyboard on edit.
    await this.bot.api.editMessageText(chatId, messageId, text);
  }

  async createTopic(chatId: number, name: string): Promise<{ topicId: number }> {
    const topic = await this.bot.api.createForumTopic(chatId, name);
    return { topicId: topic.message_thread_id };
  }

  async start(): Promise<void> {
    await new Promise<void>((res, rej) => {
      // bot.start() resolves only when the bot stops, so we capture that promise
      // and resolve start() from onStart (fires once polling is live).
      this.runningPromise = this.bot.start({
        onStart: () => res(),
        drop_pending_updates: true,
      });
      // If polling ends without us asking (e.g. a 409 conflict from a second
      // poller on the same token), grammY would otherwise stop silently and the
      // process would just drain and exit "Ready" with no clue why. Surface it
      // and exit non-zero so the OS service's restart-on-failure actually fires.
      this.runningPromise.then(
        () => {
          if (!this.stopping) this.onUnexpectedStop();
        },
        (err) => {
          if (this.stopping) return;
          this.onUnexpectedStop(err);
          rej(err); // also reject start() if this happened before onStart
        },
      );
    });
  }

  async stop(): Promise<void> {
    this.stopping = true;
    await this.bot.stop();
    if (this.runningPromise) {
      await this.runningPromise.catch(() => {});
      this.runningPromise = null;
    }
  }

  private onUnexpectedStop(err?: unknown): void {
    const detail = err instanceof Error ? err.message : err ? String(err) : "polling ended";
    console.error(`Telegram polling stopped unexpectedly: ${detail}. Exiting for service restart.`);
    process.exit(1);
  }

  private registerHandlers(): void {
    this.bot.on("message:text", async (ctx) => {
      const from = ctx.from;
      const chat = ctx.chat;
      if (!from || !chat) return;
      const event = parseText(ctx.message.text, {
        senderId: from.id,
        chatId: chat.id,
        topicId: ctx.message.message_thread_id,
        raw: ctx.update,
      });
      await this.dispatch(event);
    });

    this.bot.on("message:forum_topic_created", async (ctx) => {
      const chat = ctx.chat;
      const threadId = ctx.message.message_thread_id;
      if (!chat || threadId === undefined) return;
      await this.dispatch({
        kind: "topic-created",
        chatId: chat.id,
        topicId: threadId,
        name: ctx.message.forum_topic_created.name,
        senderId: ctx.from?.id ?? 0,
      });
    });

    this.bot.on("callback_query:data", async (ctx) => {
      const from = ctx.from;
      const msg = ctx.callbackQuery.message;
      if (!from || !msg) return;
      await this.dispatch({
        kind: "callback",
        data: ctx.callbackQuery.data,
        callbackId: ctx.callbackQuery.id,
        senderId: from.id,
        chatId: msg.chat.id,
        topicId: msg.message_thread_id,
        raw: ctx.update,
      });
      // Acknowledge so Telegram stops showing a spinner on the button.
      await ctx.answerCallbackQuery().catch(() => {});
    });
  }

  private async dispatch(event: Parameters<EventHandler>[0]): Promise<void> {
    if (!this.handler) return;
    await this.handler(event);
  }
}

function toKeyboard(rows: Button[][]): InlineKeyboard {
  const kb = new InlineKeyboard();
  rows.forEach((row, i) => {
    for (const b of row) kb.text(b.text, b.data);
    if (i < rows.length - 1) kb.row();
  });
  return kb;
}

/**
 * Append an invisible (zero-width) text_mention per user so the message pings
 * them on mobile. Using entities avoids markdown/parse_mode pitfalls.
 */
function withMentions(base: string, userIds?: number[]): { text: string; entities: MessageEntity[] } {
  const ZWSP = String.fromCharCode(0x200b);
  const entities: MessageEntity[] = [];
  let text = base;
  for (const id of userIds ?? []) {
    text += " ";
    const offset = text.length; // UTF-16 offset of the zero-width mention char
    text += ZWSP;
    entities.push({
      type: "text_mention",
      offset,
      length: 1,
      user: { id, is_bot: false, first_name: "you" },
    });
  }
  return { text, entities };
}
