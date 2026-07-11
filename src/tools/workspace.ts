import { resolve, relative, isAbsolute, join } from "node:path";

export const IGNORE_DIRS = new Set([
  ".git",
  ".hg",
  ".svn",
  ".venv",
  "venv",
  "node_modules",
  "__pycache__",
  ".mypy_cache",
  ".pytest_cache",
  ".ruff_cache",
  ".tox",
  ".nox",
  "dist",
  "build",
  ".next",
  ".nuxt",
  ".turbo",
  ".cache",
  ".arrowcode",
  "coverage",
  "target",
  ".idea",
  ".vscode",
  "bun.lockb",
]);

export const BINARY_EXT = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".ico",
  ".pdf",
  ".zip",
  ".tar",
  ".gz",
  ".exe",
  ".dll",
  ".so",
  ".dylib",
  ".bin",
  ".o",
  ".class",
  ".pyc",
  ".woff",
  ".woff2",
  ".ttf",
  ".mp3",
  ".mp4",
  ".wav",
  ".sqlite",
  ".db",
]);

export class Workspace {
  readonly root: string;

  constructor(root: string) {
    this.root = resolve(root);
  }

  resolve(path: string, opts: { mustExist?: boolean } = {}): string {
    const abs = isAbsolute(path) ? resolve(path) : resolve(this.root, path);
    const rel = relative(this.root, abs);
    if (rel.startsWith("..") || rel === "..") {
      throw new Error(`Path escapes workspace: ${path}`);
    }
    return abs;
  }

  rel(path: string): string {
    const r = relative(this.root, path);
    return r || ".";
  }

  join(...parts: string[]): string {
    return join(this.root, ...parts);
  }
}
