import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { JsonStore } from "../src/store/json.js";
import type { TopicRecord } from "../src/store/types.js";

const dir = mkdtempSync(join(tmpdir(), "tcb-store-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

function record(overrides: Partial<TopicRecord> = {}): TopicRecord {
  return {
    chatId: -100,
    topicId: 5,
    projectName: "app-A",
    projectPath: "/repos/app-A",
    sessionId: "sess-1",
    autonomy: "tiered",
    remembered: [],
    model: "opus",
    activeMachine: "desktop",
    ...overrides,
  };
}

describe("JsonStore", () => {
  it("persists records across instances (simulating restart)", () => {
    const path = join(dir, "a.json");
    new JsonStore(path).save(record());

    const reloaded = new JsonStore(path).load();
    expect(reloaded).toHaveLength(1);
    expect(reloaded[0]?.sessionId).toBe("sess-1");
  });

  it("upserts by (chatId, topicId)", () => {
    const path = join(dir, "b.json");
    const store = new JsonStore(path);
    store.save(record({ model: "opus" }));
    store.save(record({ model: "sonnet" })); // same chat+topic
    store.save(record({ topicId: 9, projectName: "bridge" }));

    const all = new JsonStore(path).load();
    expect(all).toHaveLength(2);
    expect(all.find((r) => r.topicId === 5)?.model).toBe("sonnet");
  });

  it("loads empty when the file is missing", () => {
    expect(new JsonStore(join(dir, "missing.json")).load()).toEqual([]);
  });
});
