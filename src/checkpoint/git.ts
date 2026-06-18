import { execFile } from "node:child_process";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type { Checkpointer } from "./types.js";

const exec = promisify(execFile);
let indexCounter = 0;

async function git(
  cwd: string,
  args: string[],
  extraEnv?: Record<string, string>,
): Promise<string> {
  const { stdout } = await exec("git", args, {
    cwd,
    env: { ...process.env, ...extraEnv },
    maxBuffer: 16 * 1024 * 1024,
  });
  return stdout.trim();
}

/**
 * Git-backed checkpointer. A checkpoint is a commit object built from the full
 * working tree via a throwaway index (so the user's real index is untouched),
 * parented on HEAD and anchored under `refs/tcb/checkpoints/*` so it isn't GC'd.
 * It never appears on the working branch's history.
 */
export class GitCheckpointer implements Checkpointer {
  async checkpoint(cwd: string): Promise<string | null> {
    if (!(await isRepo(cwd))) return null;

    const tmpIndex = join(tmpdir(), `tcb-index-${process.pid}-${++indexCounter}`);
    try {
      // Stage the entire working tree (tracked + untracked) into a temp index.
      await git(cwd, ["add", "-A"], { GIT_INDEX_FILE: tmpIndex });
      const tree = await git(cwd, ["write-tree"], { GIT_INDEX_FILE: tmpIndex });

      const parent = await headCommit(cwd);
      const parentArgs = parent ? ["-p", parent] : [];
      const commit = await git(cwd, ["commit-tree", tree, ...parentArgs, "-m", "tcb checkpoint"]);

      // Anchor off-history so git gc won't reclaim it.
      await git(cwd, ["update-ref", `refs/tcb/checkpoints/${commit}`, commit]).catch(() => {});
      return commit;
    } finally {
      rmSync(tmpIndex, { force: true });
    }
  }

  async restore(cwd: string, checkpoint: string): Promise<void> {
    // 1. Point the index at the snapshot tree.
    await git(cwd, ["read-tree", "--reset", checkpoint]);
    // 2. Force every index entry onto the working tree (overwrites edits,
    //    recreates files the turn deleted). -u updates stat info.
    await git(cwd, ["checkout-index", "-f", "-u", "-a"]);
    // 3. Remove files the turn created (now untracked, not in the index).
    await git(cwd, ["clean", "-fd"]);
    // The checkpoint is consumed; remove its anchor so refs don't pile up.
    await git(cwd, ["update-ref", "-d", `refs/tcb/checkpoints/${checkpoint}`]).catch(() => {});
  }

  async diff(cwd: string, checkpoint: string): Promise<string> {
    const stat = await git(cwd, ["diff", "--stat", checkpoint]);
    const status = await git(cwd, ["status", "--porcelain"]);
    const untracked = status
      .split("\n")
      .filter((l) => l.startsWith("??"))
      .map((l) => l.slice(3));

    let out = stat || "(no tracked changes since the last turn)";
    if (untracked.length) out += `\nnew/untracked:\n${untracked.map((u) => `  ${u}`).join("\n")}`;
    return out;
  }
}

async function isRepo(cwd: string): Promise<boolean> {
  try {
    await git(cwd, ["rev-parse", "--is-inside-work-tree"]);
    return true;
  } catch {
    return false;
  }
}

async function headCommit(cwd: string): Promise<string | null> {
  try {
    return await git(cwd, ["rev-parse", "HEAD"]);
  } catch {
    return null; // unborn branch (no commits yet)
  }
}
