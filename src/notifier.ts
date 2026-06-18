import type { Transport } from "./transport/types.js";

/**
 * Fires the @-mentions that make the bridge usable from a pocket: a mobile push
 * when Claude needs an approval, finishes a turn, or errors. Mid-work tool
 * activity stays silent. `/quiet` mutes only the turn-complete ping per topic;
 * approvals and errors always ping.
 */
export class Notifier {
  private readonly quiet = new Set<string>();

  constructor(
    private readonly transport: Transport,
    private readonly userIds: number[],
  ) {}

  /** User ids to mention (so other senders, e.g. the approval prompt, can ping). */
  mentions(): number[] {
    return this.userIds;
  }

  setQuiet(key: string, on: boolean): void {
    if (on) this.quiet.add(key);
    else this.quiet.delete(key);
  }

  /** Toggle quiet for a topic; returns the new state. */
  toggleQuiet(key: string): boolean {
    const on = !this.quiet.has(key);
    this.setQuiet(key, on);
    return on;
  }

  isQuiet(key: string): boolean {
    return this.quiet.has(key);
  }

  /** Ping that a turn finished and it's the user's move (suppressed by /quiet). */
  async turnComplete(chatId: number, topicId: number | undefined, key: string): Promise<void> {
    if (this.quiet.has(key)) return;
    await this.transport.send({
      chatId,
      topicId,
      text: "✅ turn complete — your move.",
      mentionUserIds: this.userIds,
    });
  }

  /** Ping that the session errored (always notifies). */
  async error(chatId: number, topicId: number | undefined, message: string): Promise<void> {
    await this.transport.send({
      chatId,
      topicId,
      text: `⚠️ ${message}`,
      mentionUserIds: this.userIds,
    });
  }
}
