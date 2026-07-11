/**
 * Workspace checkpoints for /undo — snapshots of files before agent writes.
 * Stored under the workspace (.arrowcode-checkpoints/) OR memory if home exists.
 * Prefer workspace-local so no global ~/.arrowcode is required for undo.
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  readdirSync,
  rmSync,
  statSync,
} from "node:fs";
import { join, dirname, resolve } from "node:path";

export interface CheckpointMeta {
  id: string;
  ts: number;
  label: string;
  files: string[]; // relative paths
}

export class CheckpointStore {
  private root: string; // workspace
  private dir: string;
  private stack: string[] = []; // checkpoint ids newest last

  constructor(workspace: string) {
    this.root = resolve(workspace);
    this.dir = join(this.root, ".arrowcode-checkpoints");
  }

  private ensure() {
    mkdirSync(this.dir, { recursive: true });
    // gitignore helper
    const gi = join(this.root, ".gitignore");
    try {
      if (existsSync(gi)) {
        const t = readFileSync(gi, "utf8");
        if (!t.includes(".arrowcode-checkpoints")) {
          writeFileSync(gi, t.trimEnd() + "\n.arrowcode-checkpoints/\n", "utf8");
        }
      }
    } catch {
      /* optional */
    }
  }

  /**
   * Snapshot current content of paths (before mutation).
   * paths are absolute or workspace-relative.
   */
  create(label: string, paths: string[]): CheckpointMeta {
    this.ensure();
    const id = `cp_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const cpDir = join(this.dir, id);
    mkdirSync(cpDir, { recursive: true });
    const rels: string[] = [];
    for (const p of paths) {
      const abs = resolve(this.root, p);
      let rel: string;
      try {
        rel = abs.startsWith(this.root)
          ? abs.slice(this.root.length).replace(/^[/\\]/, "")
          : p;
      } catch {
        rel = p;
      }
      if (!rel || rel.includes("..")) continue;
      const dest = join(cpDir, "files", rel);
      mkdirSync(dirname(dest), { recursive: true });
      try {
        if (existsSync(abs) && statSync(abs).isFile()) {
          writeFileSync(dest, readFileSync(abs));
          // mark existed
          writeFileSync(dest + ".meta", "existed=1\n", "utf8");
        } else {
          writeFileSync(dest + ".meta", "existed=0\n", "utf8");
        }
        rels.push(rel);
      } catch {
        /* skip unreadable */
      }
    }
    const meta: CheckpointMeta = {
      id,
      ts: Date.now(),
      label,
      files: rels,
    };
    writeFileSync(join(cpDir, "meta.json"), JSON.stringify(meta, null, 2));
    this.stack.push(id);
    // keep last 20
    while (this.stack.length > 20) {
      const old = this.stack.shift()!;
      try {
        rmSync(join(this.dir, old), { recursive: true, force: true });
      } catch {
        /* */
      }
    }
    return meta;
  }

  list(): CheckpointMeta[] {
    if (!existsSync(this.dir)) return [];
    const out: CheckpointMeta[] = [];
    for (const id of readdirSync(this.dir)) {
      const mp = join(this.dir, id, "meta.json");
      if (!existsSync(mp)) continue;
      try {
        out.push(JSON.parse(readFileSync(mp, "utf8")));
      } catch {
        /* */
      }
    }
    return out.sort((a, b) => a.ts - b.ts);
  }

  /** Restore newest checkpoint (or by id). Returns summary. */
  restore(id?: string): { ok: boolean; message: string } {
    const list = this.list();
    if (!list.length) return { ok: false, message: "No checkpoints to undo." };
    const target = id
      ? list.find((c) => c.id === id)
      : list[list.length - 1];
    if (!target) return { ok: false, message: `Checkpoint not found: ${id}` };

    const cpDir = join(this.dir, target.id, "files");
    let restored = 0;
    let deleted = 0;
    for (const rel of target.files) {
      const snap = join(cpDir, rel);
      const metaP = snap + ".meta";
      const abs = join(this.root, rel);
      let existed = true;
      if (existsSync(metaP)) {
        const m = readFileSync(metaP, "utf8");
        existed = /existed=1/.test(m);
      }
      try {
        if (!existed) {
          // file was created after checkpoint — remove it
          if (existsSync(abs)) {
            rmSync(abs, { force: true });
            deleted++;
          }
        } else if (existsSync(snap)) {
          mkdirSync(dirname(abs), { recursive: true });
          writeFileSync(abs, readFileSync(snap));
          restored++;
        }
      } catch (e) {
        return { ok: false, message: `Failed restoring ${rel}: ${e}` };
      }
    }

    // pop this and newer from stack conceptually by removing this cp
    try {
      rmSync(join(this.dir, target.id), { recursive: true, force: true });
    } catch {
      /* */
    }
    this.stack = this.stack.filter((x) => x !== target.id);

    return {
      ok: true,
      message: `Undo ${target.id} (${target.label}): restored ${restored}, removed new ${deleted}`,
    };
  }
}

/** Paths that should never be written without extreme care */
export const DENY_PATH_GLOBS = [
  /^\.env(\.|$)/i,
  /(^|\/)\.env(\.|$)/i,
  /(^|\/)secrets?\//i,
  /(^|\/)credentials\./i,
  /(^|\/)id_rsa/i,
  /(^|\/)\.aws\//i,
  /(^|\/)\.ssh\//i,
];

export function isDeniedPath(relPath: string): boolean {
  const p = relPath.replace(/\\/g, "/");
  return DENY_PATH_GLOBS.some((rx) => rx.test(p));
}

/** Safe bash patterns that can auto-approve even without YOLO */
export const BASH_ALLOWLIST: RegExp[] = [
  /^npm (test|run (test|typecheck|lint|build))(\s|$)/i,
  /^npx (tsc|vitest|jest|eslint)(\s|$)/i,
  /^bun (test|run (test|typecheck|lint))(\s|$)/i,
  /^yarn (test|lint|build)(\s|$)/i,
  /^pnpm (test|lint|build)(\s|$)/i,
  /^pytest(\s|$)/i,
  /^python -m pytest(\s|$)/i,
  /^cargo (test|check|clippy)(\s|$)/i,
  /^go test(\s|$)/i,
  /^git (status|diff|log|branch)(\s|$)/i,
  /^(ls|pwd|cat|head|tail|wc|echo|which|node -v|bun -v|python --version)(\s|$)/i,
  /^tsc --noEmit(\s|$)/i,
];

export function isBashAllowlisted(command: string): boolean {
  const c = command.trim();
  return BASH_ALLOWLIST.some((rx) => rx.test(c));
}

/** Naive secret patterns in content about to be written */
export function scanSecrets(content: string): string[] {
  const hits: string[] = [];
  const patterns: [RegExp, string][] = [
    [/-----BEGIN (RSA |OPENSSH |EC )?PRIVATE KEY-----/, "private key block"],
    [/AKIA[0-9A-Z]{16}/, "AWS access key id"],
    [/ghp_[A-Za-z0-9]{20,}/, "GitHub token"],
    [/sk-[A-Za-z0-9]{20,}/, "OpenAI-style secret key"],
    [/nvapi-[A-Za-z0-9_-]{20,}/, "NVIDIA API key"],
    [/xox[baprs]-[A-Za-z0-9-]{10,}/, "Slack token"],
  ];
  for (const [rx, name] of patterns) {
    if (rx.test(content)) hits.push(name);
  }
  return hits;
}
