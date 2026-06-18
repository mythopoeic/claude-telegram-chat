import { describe, it, expect } from "vitest";
import { validateConfig } from "../src/config.js";

const valid = {
  machineName: "desktop",
  botToken: "12345:realtoken",
  allowedUserIds: [111],
  groupChatId: null,
  projectRoots: ["/repos"],
  projects: {},
  defaultModel: "opus",
  maxConcurrentTurns: 3,
  defaultMachine: "desktop",
  allowYolo: false,
};

describe("validateConfig", () => {
  it("accepts a well-formed config", () => {
    expect(validateConfig(valid)).toEqual(valid);
  });

  it("defaults groupChatId to null when omitted", () => {
    const { groupChatId: _omit, ...rest } = valid;
    expect(validateConfig(rest).groupChatId).toBeNull();
  });

  it("defaults projectRoots/projects/defaultModel/maxConcurrentTurns when omitted", () => {
    const { projectRoots: _r, projects: _p, defaultModel: _m, maxConcurrentTurns: _c, ...rest } = valid;
    const c = validateConfig(rest);
    expect(c.projectRoots).toEqual([]);
    expect(c.projects).toEqual({});
    expect(c.defaultModel).toBe("opus");
    expect(c.maxConcurrentTurns).toBe(3);
    expect(c.defaultMachine).toBe("desktop"); // defaults to machineName
  });

  it("defaults allowYolo to false when omitted (hardened default)", () => {
    const { allowYolo: _y, ...rest } = valid;
    expect(validateConfig(rest).allowYolo).toBe(false);
  });

  it("rejects a non-boolean allowYolo", () => {
    expect(() => validateConfig({ ...valid, allowYolo: "yes" })).toThrow(/allowYolo/);
  });

  it("rejects a non-string project path", () => {
    expect(() => validateConfig({ ...valid, projects: { x: 5 } })).toThrow(/projects/);
  });

  it("rejects the placeholder token from the example file", () => {
    expect(() => validateConfig({ ...valid, botToken: "PASTE_TELEGRAM_BOT_TOKEN_FROM_BOTFATHER" })).toThrow(
      /botToken/,
    );
  });

  it("rejects an empty allowlist", () => {
    expect(() => validateConfig({ ...valid, allowedUserIds: [] })).toThrow(/allowedUserIds/);
  });

  it("rejects non-integer user ids", () => {
    expect(() => validateConfig({ ...valid, allowedUserIds: ["111"] })).toThrow(/allowedUserIds/);
  });

  it("rejects a non-object", () => {
    expect(() => validateConfig(null)).toThrow(/object/);
  });
});
