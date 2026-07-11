/**
 * Track files touched during a run for dashboard tree/diff.
 */

import { existsSync, readFileSync, statSync } from "node:fs";
import { relative, resolve } from "node:path";

export type FileTouchKind = "read" | "write" | "edit" | "delete" | "move";

export interface FileTouch {
  path: string; // relative to workspace
  kind: FileTouchKind;
  agent?: string;
  ts: number;
  before?: string;
  after?: string;
}

export class FileTracker {
  private touches: FileTouch[] = [];
  private snapshots = new Map<string, string>(); // abs path -> content before first write
  private workspace: string;

  constructor(workspace: string) {
    this.workspace = resolve(workspace);
  }

  reset() {
    this.touches = [];
    this.snapshots.clear();
  }

  private rel(p: string): string {
    const abs = resolve(this.workspace, p);
    try {
      return relative(this.workspace, abs) || ".";
    } catch {
      return p;
    }
  }

  snapshotIfNeeded(absOrRel: string) {
    const abs = resolve(this.workspace, absOrRel);
    if (this.snapshots.has(abs)) return;
    try {
      if (existsSync(abs) && statSync(abs).isFile()) {
        this.snapshots.set(abs, readFileSync(abs, "utf8"));
      } else {
        this.snapshots.set(abs, "");
      }
    } catch {
      this.snapshots.set(abs, "");
    }
  }

  record(
    kind: FileTouchKind,
    path: string,
    agent?: string,
    contentAfter?: string,
  ) {
    const abs = resolve(this.workspace, path);
    if (kind === "write" || kind === "edit" || kind === "delete") {
      this.snapshotIfNeeded(abs);
    }
    let after = contentAfter;
    if (after == null && (kind === "write" || kind === "edit")) {
      try {
        if (existsSync(abs)) after = readFileSync(abs, "utf8");
      } catch {
        /* */
      }
    }
    this.touches.push({
      path: this.rel(path),
      kind,
      agent,
      ts: Date.now(),
      before: this.snapshots.get(abs),
      after,
    });
    if (this.touches.length > 500) this.touches.shift();
  }

  list(limit = 40): FileTouch[] {
    return this.touches.slice(-limit);
  }

  /** Unique paths most recently touched */
  uniquePaths(limit = 30): string[] {
    const seen = new Set<string>();
    const out: string[] = [];
    for (let i = this.touches.length - 1; i >= 0; i--) {
      const p = this.touches[i]!.path;
      if (seen.has(p)) continue;
      seen.add(p);
      out.push(p);
      if (out.length >= limit) break;
    }
    return out;
  }

  /** Unified-ish diff for last touch of a path */
  diffFor(path: string, maxChars = 6000): string {
    const hits = this.touches.filter((t) => t.path === path);
    if (!hits.length) return "(no tracked changes)";
    const last = hits[hits.length - 1]!;
    const before = (last.before ?? "").split("\n");
    const after = (last.after ?? "").split("\n");
    if (last.kind === "delete") {
      return `--- ${path}\n+++ /dev/null\n` + before.slice(0, 80).map((l) => `- ${l}`).join("\n");
    }
    // simple line diff (LCS-lite: show removed/added by set for small files)
    const lines: string[] = [`--- a/${path}`, `+++ b/${path}`, `@@ change (${last.kind}) @@`];
    const max = 120;
    const n = Math.max(before.length, after.length);
    let shown = 0;
    for (let i = 0; i < n && shown < max; i++) {
      const b = before[i];
      const a = after[i];
      if (b === a) {
        if (b != null) lines.push(`  ${b}`);
      } else {
        if (b != null) lines.push(`- ${b}`);
        if (a != null) lines.push(`+ ${a}`);
      }
      shown++;
    }
    let text = lines.join("\n");
    if (text.length > maxChars) text = text.slice(0, maxChars) + "\n...[truncated]";
    return text;
  }
}
