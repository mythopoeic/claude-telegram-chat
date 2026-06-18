import { SAFE_TOOLS } from "../session/types.js";

/** Per-topic autonomy dial. */
export type Autonomy = "tiered" | "yolo" | "careful";

/** What to do with a tool call. */
export type Decision = "auto-allow" | "ask" | "auto-deny";

export interface PolicyState {
  autonomy: Autonomy;
  /** Tools the user chose to remember-allow for this topic. */
  remembered: ReadonlySet<string>;
}

/**
 * Pure permission decision — no I/O. The single source of truth for what gets
 * auto-allowed, asked, or auto-denied, given the topic's autonomy dial and
 * remembered allowlist.
 *
 * - yolo:    everything auto-allows (unattended burst).
 * - careful: everything is asked, even safe reads (maximum supervision).
 * - tiered:  safe reads/tests and remembered tools auto-allow; the rest is asked.
 */
export function decide(tool: string, state: PolicyState): Decision {
  switch (state.autonomy) {
    case "yolo":
      return "auto-allow";
    case "careful":
      return "ask";
    case "tiered":
      if (SAFE_TOOLS.has(tool)) return "auto-allow";
      if (state.remembered.has(tool)) return "auto-allow";
      return "ask";
  }
}

/** Parse a `/yolo` / `/careful` / `/tiered` command name into an Autonomy. */
export function autonomyFromCommand(command: string): Autonomy | undefined {
  if (command === "yolo") return "yolo";
  if (command === "careful") return "careful";
  if (command === "tiered" || command === "auto") return "tiered";
  return undefined;
}
