import { describe, it, expect } from "vitest";
import { parseText } from "../src/transport/types.js";

const meta = { senderId: 1, chatId: 2 };

describe("parseText", () => {
  it("treats a plain sentence as a message", () => {
    const e = parseText("fix the failing test", meta);
    expect(e.kind).toBe("message");
    if (e.kind === "message") expect(e.text).toBe("fix the failing test");
  });

  it("parses a slash command with args", () => {
    const e = parseText("/model opus", meta);
    expect(e.kind).toBe("command");
    if (e.kind === "command") {
      expect(e.command).toBe("model");
      expect(e.args).toBe("opus");
    }
  });

  it("parses bare word commands so a phone can skip the slash", () => {
    const e = parseText("new app-A", meta);
    expect(e.kind).toBe("command");
    if (e.kind === "command") {
      expect(e.command).toBe("new");
      expect(e.args).toBe("app-A");
    }
  });

  it("strips an @botname suffix from group commands", () => {
    const e = parseText("/status@claude_desktop_bot", meta);
    expect(e.kind).toBe("command");
    if (e.kind === "command") {
      expect(e.command).toBe("status");
      expect(e.args).toBe("");
    }
  });

  it("does not treat an unknown bare word as a command", () => {
    const e = parseText("status", meta);
    // 'status' IS a known control command — sanity that a non-known word is a message
    const other = parseText("refactor", meta);
    expect(e.kind).toBe("command");
    expect(other.kind).toBe("message");
  });
});
