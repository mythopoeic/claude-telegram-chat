import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { discoverRegistry, registryFrom } from "../src/registry/discover.js";

describe("registryFrom", () => {
  const r = registryFrom(
    new Map([
      ["bridge", { name: "bridge", path: "/repos/bridge" }],
      ["app-A", { name: "app-A", path: "/repos/app-A" }],
    ]),
  );

  it("lists projects sorted by name", () => {
    expect(r.list().map((p) => p.name)).toEqual(["app-A", "bridge"]);
  });

  it("resolves case-insensitively and trims", () => {
    expect(r.resolve("  APP-A ")?.path).toBe("/repos/app-A");
    expect(r.resolve("missing")).toBeUndefined();
  });
});

describe("discoverRegistry", () => {
  const root = mkdtempSync(join(tmpdir(), "tcb-reg-"));
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  it("finds child dirs that are git repos and ignores the rest", () => {
    mkdirSync(join(root, "repo-a", ".git"), { recursive: true });
    mkdirSync(join(root, "repo-b", ".git"), { recursive: true });
    mkdirSync(join(root, "not-a-repo"), { recursive: true }); // no .git

    const reg = discoverRegistry({ roots: [root] });
    expect(reg.list().map((p) => p.name)).toEqual(["repo-a", "repo-b"]);
  });

  it("layers overrides on top of (and winning over) discovery", () => {
    const reg = discoverRegistry({
      roots: [root],
      overrides: { custom: "/elsewhere/custom" },
    });
    // path is resolved to absolute (platform-specific), so match the leaf.
    expect(reg.resolve("custom")?.path).toMatch(/[/\\]elsewhere[/\\]custom$/);
    expect(reg.resolve("repo-a")).toBeDefined();
  });

  it("tolerates a non-existent root", () => {
    const reg = discoverRegistry({ roots: [join(root, "does-not-exist")] });
    expect(reg.list()).toEqual([]);
  });
});
