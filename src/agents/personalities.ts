/**
 * Agent personalities:
 * - Source of truth in repo: defaults/agents/*.md
 * - User runtime copy: ~/.arrowcode/agents/*.md (created on install/setup only)
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  readdirSync,
} from "node:fs";
import { join } from "node:path";
import { AGENTS_DIR, defaultsAgentsDir } from "../config/paths";
import { AGENT_META, type AgentId, AGENT_ORDER } from "../config/types";
import { bootstrapUserHome, isUserHomePresent } from "../bootstrap/install-home";
import { ensureArrowHome } from "../config/load";
import { perfCaches } from "../perf/cache";

function readPackaged(id: AgentId): string {
  const file = AGENT_META[id].file;
  const p = join(defaultsAgentsDir(), file);
  if (existsSync(p)) return readFileSync(p, "utf8");
  return `# ${AGENT_META[id].title}\n${AGENT_META[id].role}\n`;
}

/**
 * Ensure ~/.arrowcode/agents exists by bootstrapping from defaults/.
 * Does not overwrite existing user files.
 */
export function seedAgentPersonalities(): void {
  // Only materialize ~/.arrowcode when it already exists or caller bootstrapped install
  if (!isUserHomePresent()) {
    // do not create home — packaged defaults are enough until install
    return;
  }
  bootstrapUserHome();
  ensureArrowHome();
  mkdirSync(AGENTS_DIR, { recursive: true });
  for (const id of AGENT_ORDER) {
    const dest = join(AGENTS_DIR, AGENT_META[id].file);
    if (existsSync(dest)) continue;
    writeFileSync(dest, readPackaged(id), "utf8");
  }
}

export function loadAgentPersonality(id: AgentId): string {
  const cacheKey = `pers:${id}:${isUserHomePresent() ? "home" : "pkg"}`;
  const hit = perfCaches.personality.get(cacheKey);
  if (hit) return hit;
  // Prefer user home if present; else packaged defaults/ in repo
  let body: string;
  if (isUserHomePresent()) {
    seedAgentPersonalities();
    const path = join(AGENTS_DIR, AGENT_META[id].file);
    if (existsSync(path)) {
      try {
        body = readFileSync(path, "utf8");
        perfCaches.personality.set(cacheKey, body);
        return body;
      } catch { /* fall through */ }
    }
  }
  body = readPackaged(id);
  perfCaches.personality.set(cacheKey, body);
  return body;
}

export function saveAgentPersonality(id: AgentId, content: string): string {
  seedAgentPersonalities();
  const path = join(AGENTS_DIR, AGENT_META[id].file);
  writeFileSync(path, content, "utf8");
  return path;
}

export function listAgentPersonalityPaths(): Record<AgentId, string> {
  seedAgentPersonalities();
  const out = {} as Record<AgentId, string>;
  for (const id of AGENT_ORDER) {
    out[id] = join(AGENTS_DIR, AGENT_META[id].file);
  }
  return out;
}

export function listAgentFiles(): string[] {
  seedAgentPersonalities();
  try {
    return readdirSync(AGENTS_DIR).filter((f) => f.endsWith(".md"));
  } catch {
    return [];
  }
}

/** Paths to packaged defaults (in git repo) for docs / debugging */
export function packagedAgentPaths(): Record<AgentId, string> {
  const out = {} as Record<AgentId, string>;
  for (const id of AGENT_ORDER) {
    out[id] = join(defaultsAgentsDir(), AGENT_META[id].file);
  }
  return out;
}
