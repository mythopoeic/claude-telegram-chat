import { existsSync, readdirSync, statSync } from "node:fs";
import { basename, resolve } from "node:path";
import type { Project, Registry } from "./types.js";

/**
 * Builds a registry by scanning configured roots for immediate child
 * directories that are git repos, then layering hand-specified overrides on
 * top. Discovery means near-zero setup; overrides let you add a repo that
 * lives outside the scanned roots or give it a custom name.
 *
 * Name collisions resolve in favor of explicit overrides, then first-seen.
 */
export function discoverRegistry(opts: {
  roots: string[];
  overrides?: Record<string, string>;
}): Registry {
  const byName = new Map<string, Project>();

  for (const root of opts.roots) {
    for (const proj of scanRoot(root)) {
      if (!byName.has(proj.name)) byName.set(proj.name, proj);
    }
  }

  // Overrides win and can also rename/add.
  for (const [name, path] of Object.entries(opts.overrides ?? {})) {
    byName.set(name, { name, path: resolve(path) });
  }

  return registryFrom(byName);
}

/** Builds a Registry from an explicit name→Project map (used by tests too). */
export function registryFrom(byName: Map<string, Project>): Registry {
  const lower = new Map<string, Project>();
  for (const proj of byName.values()) lower.set(proj.name.toLowerCase(), proj);

  return {
    list: () =>
      [...byName.values()].sort((a, b) => a.name.localeCompare(b.name)),
    resolve: (name) => lower.get(name.trim().toLowerCase()),
  };
}

function scanRoot(root: string): Project[] {
  const abs = resolve(root);
  if (!existsSync(abs)) return [];

  let entries: string[];
  try {
    entries = readdirSync(abs);
  } catch {
    return [];
  }

  const projects: Project[] = [];
  for (const entry of entries) {
    const path = resolve(abs, entry);
    let isDir = false;
    try {
      isDir = statSync(path).isDirectory();
    } catch {
      continue;
    }
    if (!isDir) continue;
    if (existsSync(resolve(path, ".git"))) {
      projects.push({ name: basename(path), path });
    }
  }
  return projects;
}
