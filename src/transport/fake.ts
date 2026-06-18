import {
  parseText,
  type EventHandler,
  type InboundEvent,
  type OutboundMessage,
  type SentMessage,
  type Transport,
} from "./types.js";

/**
 * In-memory Transport for tests. Lets a test push inbound events and inspect
 * everything the daemon sent — no Telegram, no network. This is the harness the
 * whole project's behavior is tested against.
 */
export class FakeTransport implements Transport {
  private handler: EventHandler | null = null;
  private nextMessageId = 1;
  private nextTopicId = 1;
  /** Every message the daemon asked to send, in order. */
  readonly sent: OutboundMessage[] = [];
  /** Every topic the daemon asked to create, in order. */
  readonly topics: { chatId: number; name: string; topicId: number }[] = [];
  /** Every in-place edit, in order. */
  readonly edits: { chatId: number; messageId: number; text: string }[] = [];

  onEvent(handler: EventHandler): void {
    this.handler = handler;
  }

  async send(message: OutboundMessage): Promise<SentMessage> {
    this.sent.push(message);
    return { messageId: this.nextMessageId++ };
  }

  async edit(chatId: number, messageId: number, text: string): Promise<void> {
    this.edits.push({ chatId, messageId, text });
  }

  async createTopic(chatId: number, name: string): Promise<{ topicId: number }> {
    const topicId = this.nextTopicId++;
    this.topics.push({ chatId, name, topicId });
    return { topicId };
  }

  async start(): Promise<void> {}
  async stop(): Promise<void> {}

  /** Simulate Telegram announcing a new forum topic (both daemons see this). */
  async emitTopicCreated(
    name: string,
    opts: { topicId: number; chatId?: number; senderId?: number },
  ): Promise<void> {
    await this.emit({
      kind: "topic-created",
      name,
      topicId: opts.topicId,
      chatId: opts.chatId ?? -100,
      senderId: opts.senderId ?? 1,
    });
  }

  /** Text of the most recently sent message (test convenience). */
  lastText(): string | undefined {
    return this.sent.at(-1)?.text;
  }

  /** Deliver a fully-formed inbound event to the daemon and await handling. */
  async emit(event: InboundEvent): Promise<void> {
    if (!this.handler) throw new Error("no handler registered on FakeTransport");
    await this.handler(event);
  }

  /**
   * Convenience: deliver a text message as the given user, parsed through the
   * same command/message logic the real transport uses.
   */
  async emitText(
    text: string,
    opts: { senderId: number; chatId?: number; topicId?: number },
  ): Promise<void> {
    const chatId = opts.chatId ?? -100;
    const event = parseText(text, {
      senderId: opts.senderId,
      chatId,
      topicId: opts.topicId,
    });
    await this.emit(event);
  }
}
