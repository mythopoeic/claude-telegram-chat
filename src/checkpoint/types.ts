/**
 * Snapshots a project's working tree before a turn so a bad turn can be undone.
 * Backed by git, kept off the branch history. Pure interface so the router is
 * tested with a fake and the real git behavior is tested against a temp repo.
 */
export interface Checkpointer {
  /**
   * Snapshot the full working tree (tracked + staged + untracked) and return an
   * opaque checkpoint id, or null if the path isn't a git repo.
   */
  checkpoint(cwd: string): Promise<string | null>;
  /** Restore the working tree to a checkpoint, losslessly (incl. removing files added since). */
  restore(cwd: string, checkpoint: string): Promise<void>;
  /** A short, human-readable summary of what changed since a checkpoint. */
  diff(cwd: string, checkpoint: string): Promise<string>;
}
