import type { Checkpointer } from "./types.js";

/** In-memory checkpointer for router tests; records calls. */
export class FakeCheckpointer implements Checkpointer {
  readonly checkpoints: { cwd: string; id: string }[] = [];
  readonly restores: { cwd: string; id: string }[] = [];
  private counter = 0;
  /** When set, checkpoint() returns null (simulating a non-git path). */
  notARepo = false;

  async checkpoint(cwd: string): Promise<string | null> {
    if (this.notARepo) return null;
    const id = `cp-${++this.counter}`;
    this.checkpoints.push({ cwd, id });
    return id;
  }

  async restore(cwd: string, id: string): Promise<void> {
    this.restores.push({ cwd, id });
  }

  async diff(_cwd: string, id: string): Promise<string> {
    return `DIFF for ${id}`;
  }
}
