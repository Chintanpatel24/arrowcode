/**
 * Resolve packaged defaults inside the git repo / install tree,
 * and user home paths created only after install/setup.
 */

import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** Repo / install root (contains package.json, defaults/, src/) */
export function packageRoot(): string {
  // src/bootstrap -> src -> root
  const here = dirname(fileURLToPath(import.meta.url));
  let dir = join(here, "../..");
  // walk up a few levels if needed
  for (let i = 0; i < 5; i++) {
    if (existsSync(join(dir, "package.json"))) return dir;
    dir = join(dir, "..");
  }
  return join(here, "../..");
}

export function defaultsRoot(): string {
  return join(packageRoot(), "defaults");
}

export function defaultsAgentsDir(): string {
  return join(defaultsRoot(), "agents");
}

export function defaultsTemplatesDir(): string {
  return join(defaultsRoot(), "templates");
}

export function defaultsConfigDir(): string {
  return join(defaultsRoot(), "config");
}

/** User data — created on install / first setup only */
export const ARROW_HOME = join(homedir(), ".arrowcode");
export const ENV_PATH = join(ARROW_HOME, ".env");
export const CONFIG_PATH = join(ARROW_HOME, "config.yaml");
export const SETTINGS_PATH = join(ARROW_HOME, "settings.yaml");
export const AGENTS_YAML_PATH = join(ARROW_HOME, "agents.yaml");
export const HISTORY_PATH = join(ARROW_HOME, "history");
export const SESSIONS_DIR = join(ARROW_HOME, "sessions");
export const AGENTS_DIR = join(ARROW_HOME, "agents");
export const TEMPLATES_DIR = join(ARROW_HOME, "templates");
export const GOAL_PATH = join(ARROW_HOME, "goal.md");
export const PLAN_PATH = join(ARROW_HOME, "plan.md");
export const MEMORY_DIR = join(ARROW_HOME, "memory");
