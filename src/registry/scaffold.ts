import { execFile } from "node:child_process";
import { mkdirSync } from "node:fs";
import { promisify } from "node:util";

const exec = promisify(execFile);

/**
 * Create a brand-new project directory and initialize it as a git repo. The
 * git repo matters for two reasons: the checkpointer snapshots turns via git
 * (so /undo works from the first turn), and discovery only auto-registers
 * directories that contain a `.git`, so a created project survives a restart
 * without any config edit. Used by the `/create` command.
 */
export async function scaffoldProject(path: string): Promise<void> {
  mkdirSync(path, { recursive: true });
  await exec("git", ["init"], { cwd: path });
}
