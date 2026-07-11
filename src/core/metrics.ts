/**
 * Session metrics + lightweight journal for a sharper harness.
 */

import { appendFileSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { MEMORY_DIR } from "../config/paths";
import { ensureArrowHome } from "../config/load";

export interface SessionMetrics {
  startedAt: number;
  plans: number;
  questions: number;
  toolCalls: number;
  spawns: number;
  cycles: number;
  tokensIn: number;
  tokensOut: number;
  errors: number;
  accepts: number;
}

export function createMetrics(): SessionMetrics {
  return {
    startedAt: Date.now(),
    plans: 0,
    questions: 0,
    toolCalls: 0,
    spawns: 0,
    cycles: 0,
    tokensIn: 0,
    tokensOut: 0,
    errors: 0,
    accepts: 0,
  };
}

export function formatMetrics(m: SessionMetrics): string {
  const mins = ((Date.now() - m.startedAt) / 60000).toFixed(1);
  return [
    `session ${mins}m`,
    `plans ${m.plans}`,
    `questions ${m.questions}`,
    `tools ${m.toolCalls}`,
    `spawns ${m.spawns}`,
    `cycles ${m.cycles}`,
    `tokens ${m.tokensIn}/${m.tokensOut}`,
    `errors ${m.errors}`,
    `accepts ${m.accepts}`,
  ].join(" | ");
}

export function journal(line: string): void {
  try {
    // Only journal if user home already exists — never create ~/.arrowcode just for logs
    const home = join(MEMORY_DIR, "..");
    if (!existsSync(home)) return;
    if (!existsSync(MEMORY_DIR)) mkdirSync(MEMORY_DIR, { recursive: true });
    const file = join(MEMORY_DIR, "journal.log");
    appendFileSync(file, `${new Date().toISOString()} ${line}\n`, "utf8");
  } catch {
    /* non-fatal */
  }
}

export function writeSessionSnapshot(
  name: string,
  data: Record<string, unknown>,
  workspaceFallback?: string,
): string {
  // Prefer workspace-local sessions; never force-create ~/.arrowcode
  const home = join(MEMORY_DIR, "..");
  let dir: string;
  if (existsSync(home)) {
    dir = join(MEMORY_DIR, "sessions");
  } else {
    const ws = workspaceFallback || process.cwd();
    dir = join(ws, ".arrowcode-sessions", "snapshots");
  }
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${name}.json`);
  writeFileSync(path, JSON.stringify(data, null, 2), "utf8");
  return path;
}
