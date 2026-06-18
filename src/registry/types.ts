/** A registered project the daemon can start a session in. */
export interface Project {
  /** Short, phone-friendly name (used in `new <name>`). */
  name: string;
  /** Absolute path to the project working directory. */
  path: string;
}

/** Resolves project names to working directories. */
export interface Registry {
  /** All known projects, sorted by name. */
  list(): Project[];
  /** Look up a project by name (case-insensitive), or undefined. */
  resolve(name: string): Project | undefined;
}
