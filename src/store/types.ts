import type { Autonomy } from "../permission/policy.js";

/** Everything needed to resume a topic's session after a restart. */
export interface TopicRecord {
  chatId: number;
  topicId: number;
  projectName: string;
  projectPath: string;
  /** SDK session id for resume; null until the first turn assigns one. */
  sessionId: string | null;
  autonomy: Autonomy;
  /** Tools the user chose to remember-allow for this topic. */
  remembered: string[];
  model: string;
  /** Which machine handles this topic (shared-group delegation). */
  activeMachine: string;
  /**
   * When true, the session is told to answer tersely (concise mode) — easier to
   * read on a phone. Toggled per-topic with /concise. Optional for backward
   * compat with records written before this field existed (treated as false).
   */
  concise?: boolean;
}

/**
 * Persistence seam for topic↔session state. Synchronous by design — the data is
 * tiny and load() must complete before the daemon starts handling events.
 */
export interface Store {
  /** All persisted topic records (called once on startup). */
  load(): TopicRecord[];
  /** Upsert a record by (chatId, topicId). */
  save(record: TopicRecord): void;
}

export const recordKey = (chatId: number, topicId: number): string => `${chatId}:${topicId}`;
