import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GitCheckpointer } from "../src/checkpoint/git.js";

function git(cwd: string, ...args: string[]): void {
  execFileSync("git", args, { cwd, stdio: "pipe" });
}

const repo = mkdtempSync(join(tmpdir(), "tcb-ckpt-"));
const cp = new GitCheckpointer();

beforeAll(() => {
  git(repo, "init", "-q");
  git(repo, "config", "user.email", "t@t.t");
  git(repo, "config", "user.name", "t");
  git(repo, "config", "commit.gpgsign", "false");
  git(repo, "config", "core.autocrlf", "false"); // preserve byte-exact line endings
  writeFileSync(join(repo, "keep.txt"), "original\n");
  writeFileSync(join(repo, "delete-me.txt"), "doomed\n");
  git(repo, "add", "-A");
  git(repo, "commit", "-q", "-m", "init");
});

afterAll(() => rmSync(repo, { recursive: true, force: true }));

describe("GitCheckpointer", () => {
  it("returns null for a non-git directory", async () => {
    const plain = mkdtempSync(join(tmpdir(), "tcb-plain-"));
    try {
      expect(await cp.checkpoint(plain)).toBeNull();
    } finally {
      rmSync(plain, { recursive: true, force: true });
    }
  });

  it("restores tracked edits, new files, and deletions losslessly", async () => {
    const checkpoint = await cp.checkpoint(repo);
    expect(checkpoint).toBeTruthy();

    // Simulate a turn: edit a tracked file, add a new file, delete a tracked file.
    writeFileSync(join(repo, "keep.txt"), "MODIFIED\n");
    writeFileSync(join(repo, "new-file.txt"), "created by the turn\n");
    rmSync(join(repo, "delete-me.txt"));

    await cp.restore(repo, checkpoint!);

    expect(readFileSync(join(repo, "keep.txt"), "utf8")).toBe("original\n"); // edit reverted
    expect(existsSync(join(repo, "new-file.txt"))).toBe(false); // added file removed
    expect(existsSync(join(repo, "delete-me.txt"))).toBe(true); // deletion restored
  });

  it("does not add checkpoints to the branch history", async () => {
    const before = execFileSync("git", ["rev-list", "--count", "HEAD"], { cwd: repo })
      .toString()
      .trim();
    await cp.checkpoint(repo);
    const after = execFileSync("git", ["rev-list", "--count", "HEAD"], { cwd: repo })
      .toString()
      .trim();
    expect(after).toBe(before); // HEAD history unchanged
  });

  it("summarizes changes in diff()", async () => {
    const checkpoint = await cp.checkpoint(repo);
    writeFileSync(join(repo, "keep.txt"), "changed again\n");
    writeFileSync(join(repo, "fresh.txt"), "brand new\n");

    const summary = await cp.diff(repo, checkpoint!);
    expect(summary).toContain("keep.txt");
    expect(summary).toContain("fresh.txt");
  });
});
