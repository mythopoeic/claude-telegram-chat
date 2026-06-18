import { recordKey, type Store, type TopicRecord } from "./types.js";

/** In-memory Store for tests; also records the sequence of saves. */
export class FakeStore implements Store {
  private readonly records = new Map<string, TopicRecord>();
  readonly saves: TopicRecord[] = [];

  /** Pre-seed records as if loaded from a prior run. */
  seed(records: TopicRecord[]): this {
    for (const r of records) this.records.set(recordKey(r.chatId, r.topicId), r);
    return this;
  }

  load(): TopicRecord[] {
    return [...this.records.values()];
  }

  save(record: TopicRecord): void {
    // store a snapshot so later mutation of the live object doesn't rewrite history
    const snapshot = { ...record, remembered: [...record.remembered] };
    this.records.set(recordKey(record.chatId, record.topicId), snapshot);
    this.saves.push(snapshot);
  }
}
