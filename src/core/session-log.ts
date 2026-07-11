/**
 * Session event log for dashboard timeline + replay export.
 */

import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { MEMORY_DIR } from "../config/paths";
import { ensureArrowHome } from "../config/load";

export type SessionEventKind =
  | "phase"
  | "user"
  | "plan"
  | "question"
  | "tool"
  | "bus"
  | "swarm"
  | "system"
  | "final"
  | "accept"
  | "error"
  | "file";

export interface SessionEvent {
  id: string;
  ts: number;
  kind: SessionEventKind;
  agent?: string;
  title: string;
  detail?: string;
}

export class SessionLog {
  private events: SessionEvent[] = [];
  private seq = 0;
  private listeners = new Set<(e: SessionEvent) => void>();

  on(fn: (e: SessionEvent) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  push(
    kind: SessionEventKind,
    title: string,
    opts?: { agent?: string; detail?: string },
  ): SessionEvent {
    const e: SessionEvent = {
      id: `ev_${++this.seq}`,
      ts: Date.now(),
      kind,
      title,
      agent: opts?.agent,
      detail: opts?.detail?.slice(0, 2000),
    };
    this.events.push(e);
    if (this.events.length > 2000) this.events.shift();
    for (const fn of this.listeners) {
      try {
        fn(e);
      } catch {
        /* */
      }
    }
    return e;
  }

  list(limit = 80): SessionEvent[] {
    return this.events.slice(-limit);
  }

  all(): SessionEvent[] {
    return [...this.events];
  }

  clear() {
    this.events = [];
    this.seq = 0;
  }

  exportPath(name?: string, workspaceFallback?: string): string {
    // Prefer workspace sessions/checkpoints — never force-create ~/.arrowcode
    const ws = workspaceFallback || process.cwd();
    let dir = join(ws, ".arrowcode-sessions", "replays");
    try {
      if (existsSync(join(MEMORY_DIR, ".."))) {
        dir = join(MEMORY_DIR, "replays");
      }
    } catch {
      /* keep workspace dir */
    }
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const path = join(dir, `${name || `session_${Date.now()}`}.json`);
    writeFileSync(
      path,
      JSON.stringify(
        { exportedAt: new Date().toISOString(), events: this.events },
        null,
        2,
      ),
      "utf8",
    );
    return path;
  }
}
