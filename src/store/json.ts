import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { recordKey, type Store, type TopicRecord } from "./types.js";

/**
 * JSON-file Store. Keeps records in memory and rewrites the whole file on each
 * save — fine for a handful of topics. Missing/corrupt files load as empty so a
 * fresh machine just starts clean.
 */
export class JsonStore implements Store {
  private readonly records = new Map<string, TopicRecord>();
  private loaded = false;

  constructor(private readonly path: string) {}

  load(): TopicRecord[] {
    if (!this.loaded) {
      try {
        const parsed = JSON.parse(readFileSync(this.path, "utf8"));
        if (Array.isArray(parsed)) {
          for (const r of parsed as TopicRecord[]) {
            this.records.set(recordKey(r.chatId, r.topicId), r);
          }
        }
      } catch {
        // missing or unreadable → start empty
      }
      this.loaded = true;
    }
    return [...this.records.values()];
  }

  save(record: TopicRecord): void {
    this.records.set(recordKey(record.chatId, record.topicId), record);
    mkdirSync(dirname(this.path), { recursive: true });
    writeFileSync(this.path, JSON.stringify([...this.records.values()], null, 2));
  }
}
