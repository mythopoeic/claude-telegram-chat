import { describe, it, expect } from "vitest";
import { createTurnRenderer, toolLine, chunkText } from "../src/render.js";
import { FakeTransport } from "../src/transport/fake.js";
import type { SessionEvent } from "../src/session/types.js";

const CHAT = -100;
const TOPIC = 7;

async function run(events: SessionEvent[]) {
  const transport = new FakeTransport();
  const renderer = createTurnRenderer(transport, CHAT, TOPIC);
  for (const e of events) await renderer.handle(e);
  return transport;
}

describe("toolLine", () => {
  it("summarizes common tools compactly", () => {
    expect(toolLine("Read", { file_path: "/a/b/app.ts" })).toBe("📖 read app.ts");
    expect(toolLine("Edit", { file_path: "/a/b/app.ts" })).toBe("✎ edit app.ts");
    expect(toolLine("Bash", { command: "pytest -q" })).toBe("▶ pytest -q");
    expect(toolLine("Grep", { pattern: "TODO" })).toBe('🔍 grep "TODO"');
    expect(toolLine("Mystery", {})).toBe("• Mystery");
  });
});

describe("chunkText", () => {
  it("returns one chunk when under the limit", () => {
    expect(chunkText("hello", 100)).toEqual(["hello"]);
  });

  it("splits oversized text into limit-sized chunks", () => {
    const big = "x".repeat(50);
    const chunks = chunkText(big, 20);
    expect(chunks.every((c) => c.length <= 20)).toBe(true);
    expect(chunks.join("")).toBe(big);
  });
});

describe("turn rendering", () => {
  it("posts assistant prose as a full message", async () => {
    const t = await run([
      { kind: "assistant-text", text: "Here's the plan." },
      { kind: "turn-done" },
    ]);
    expect(t.sent.map((s) => s.text)).toContain("Here's the plan.");
    expect(t.sent[0]?.topicId).toBe(TOPIC);
  });

  it("collapses many tool calls into one working message edited in place", async () => {
    const t = await run([
      { kind: "tool-request", id: "1", tool: "Read", input: { file_path: "/x/a.ts" } },
      { kind: "tool-result", id: "1", tool: "", ok: true },
      { kind: "tool-request", id: "2", tool: "Bash", input: { command: "pytest" } },
      { kind: "tool-result", id: "2", tool: "", ok: true },
      { kind: "turn-done" },
    ]);

    // Exactly one message was *sent* for the working line; the rest are edits.
    expect(t.sent).toHaveLength(1);
    expect(t.edits.length).toBeGreaterThan(0);

    const finalText = t.edits.at(-1)!.text;
    expect(finalText).toContain("read a.ts ✓");
    expect(finalText).toContain("pytest ✓");
    expect(finalText).not.toContain("working…"); // finalized on turn-done
  });

  it("starts a fresh working line after prose interleaves", async () => {
    const t = await run([
      { kind: "tool-request", id: "1", tool: "Read", input: { file_path: "/x/a.ts" } },
      { kind: "assistant-text", text: "Found it." },
      { kind: "tool-request", id: "2", tool: "Edit", input: { file_path: "/x/a.ts" } },
      { kind: "turn-done" },
    ]);
    // Two working-line sends (before and after the prose) + one prose send.
    const sentTexts = t.sent.map((s) => s.text);
    expect(sentTexts).toContain("Found it.");
    expect(t.sent.filter((s) => s.text.includes("working…")).length).toBe(2);
  });

  it("throttles edits under a burst of tool calls (no edit-per-event)", async () => {
    const transport = new FakeTransport();
    const renderer = createTurnRenderer(transport, CHAT, TOPIC);
    for (let i = 0; i < 10; i++) {
      await renderer.handle({ kind: "tool-request", id: String(i), tool: "Read", input: { file_path: `/x/f${i}.ts` } });
    }
    await renderer.handle({ kind: "turn-done" });

    expect(transport.sent).toHaveLength(1); // one working-line message created
    expect(transport.edits.length).toBeLessThanOrEqual(2); // coalesced, not 10
    expect(transport.edits.at(-1)?.text).toContain("f9.ts"); // final state still flushed
  });

  it("renders errors as their own message", async () => {
    const t = await run([{ kind: "error", message: "boom" }]);
    expect(t.lastText()).toBe("⚠️ boom");
  });
});
