/**
 * Extra built-in tools — diagnostics, multi-edit, search, notebook, memory notes.
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  readdirSync,
  statSync,
  appendFileSync,
  unlinkSync,
  renameSync,
} from "node:fs";
import { join, dirname, extname } from "node:path";
import { spawn } from "node:child_process";
import type { ToolDefinition, ToolResult } from "./types";
import { Workspace, IGNORE_DIRS, BINARY_EXT } from "./workspace";
import { MEMORY_DIR } from "../config/paths";
import { ensureArrowHome } from "../config/load";

function ok(output: string, metadata?: Record<string, unknown>): ToolResult {
  return { success: true, output, metadata };
}
function fail(error: string, output = ""): ToolResult {
  return { success: false, output, error };
}

async function run(
  command: string,
  cwd: string,
  timeoutSec = 60,
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(command, {
      shell: true,
      cwd,
      env: { ...process.env, TERM: "dumb", PAGER: "cat", GIT_PAGER: "cat" },
    });
    let stdout = "";
    let stderr = "";
    const t = setTimeout(() => {
      child.kill("SIGKILL");
      resolve({ code: 124, stdout, stderr: stderr + "\n[timeout]" });
    }, timeoutSec * 1000);
    child.stdout?.on("data", (d) => {
      stdout += d.toString();
      if (stdout.length > 100_000) stdout = stdout.slice(-50_000);
    });
    child.stderr?.on("data", (d) => {
      stderr += d.toString();
    });
    child.on("close", (code) => {
      clearTimeout(t);
      resolve({ code: code ?? 1, stdout, stderr });
    });
    child.on("error", (e) => {
      clearTimeout(t);
      resolve({ code: 1, stdout: "", stderr: String(e) });
    });
  });
}

export function buildExtraTools(ws: Workspace): ToolDefinition[] {
  const multi_edit: ToolDefinition = {
    name: "multi_edit",
    description:
      "Apply multiple search/replace edits across one or more files in one call. Each edit needs path, old_text, new_text.",
    readOnly: false,
    requiresApproval: true,
    parameters: {
      type: "object",
      properties: {
        edits: {
          type: "array",
          description: "List of {path, old_text, new_text, replace_all?}",
          items: { type: "object" },
        },
      },
      required: ["edits"],
    },
    execute: ({ edits }) => {
      const list = Array.isArray(edits) ? edits : [];
      if (!list.length) return fail("No edits provided");
      const results: string[] = [];
      for (const e of list as {
        path: string;
        old_text: string;
        new_text: string;
        replace_all?: boolean;
      }[]) {
        try {
          const fp = ws.resolve(String(e.path));
          if (!existsSync(fp)) {
            results.push(`FAIL ${e.path}: not found`);
            continue;
          }
          let text = readFileSync(fp, "utf8");
          const oldT = String(e.old_text);
          const newT = String(e.new_text ?? "");
          if (!text.includes(oldT)) {
            results.push(`FAIL ${e.path}: old_text not found`);
            continue;
          }
          const count = text.split(oldT).length - 1;
          if (count > 1 && !e.replace_all) {
            results.push(
              `FAIL ${e.path}: ${count} matches (set replace_all or more context)`,
            );
            continue;
          }
          text = e.replace_all
            ? text.split(oldT).join(newT)
            : text.replace(oldT, newT);
          writeFileSync(fp, text, "utf8");
          results.push(`OK ${ws.rel(fp)} x${e.replace_all ? count : 1}`);
        } catch (err) {
          results.push(`FAIL ${e.path}: ${err}`);
        }
      }
      const failed = results.some((r) => r.startsWith("FAIL"));
      return failed
        ? fail("Some edits failed", results.join("\n"))
        : ok(results.join("\n"));
    },
  };

  const delete_file: ToolDefinition = {
    name: "delete_file",
    description: "Delete a file inside the workspace (not directories).",
    readOnly: false,
    requiresApproval: true,
    parameters: {
      type: "object",
      properties: {
        path: { type: "string" },
      },
      required: ["path"],
    },
    execute: ({ path }) => {
      try {
        const fp = ws.resolve(String(path));
        if (!existsSync(fp)) return fail(`Not found: ${path}`);
        if (statSync(fp).isDirectory())
          return fail("Refusing to delete directory — use bash carefully");
        unlinkSync(fp);
        return ok(`Deleted ${ws.rel(fp)}`);
      } catch (e) {
        return fail(String(e));
      }
    },
  };

  const move_file: ToolDefinition = {
    name: "move_file",
    description: "Move or rename a file within the workspace.",
    readOnly: false,
    requiresApproval: true,
    parameters: {
      type: "object",
      properties: {
        from: { type: "string" },
        to: { type: "string" },
      },
      required: ["from", "to"],
    },
    execute: ({ from, to }) => {
      try {
        const src = ws.resolve(String(from));
        const dest = ws.resolve(String(to));
        if (!existsSync(src)) return fail(`Not found: ${from}`);
        mkdirSync(dirname(dest), { recursive: true });
        renameSync(src, dest);
        return ok(`Moved ${ws.rel(src)} → ${ws.rel(dest)}`);
      } catch (e) {
        return fail(String(e));
      }
    },
  };

  const tree: ToolDefinition = {
    name: "tree",
    description:
      "Show a directory tree (depth-limited). Skips node_modules, .git, etc.",
    readOnly: true,
    requiresApproval: false,
    parameters: {
      type: "object",
      properties: {
        path: { type: "string" },
        max_depth: { type: "number" },
      },
    },
    execute: ({ path, max_depth }) => {
      try {
        const root = ws.resolve(String(path || "."));
        if (!existsSync(root) || !statSync(root).isDirectory())
          return fail("Not a directory");
        const maxD = Math.min(Number(max_depth) || 3, 6);
        const lines: string[] = [ws.rel(root) + "/"];
        const walk = (dir: string, prefix: string, depth: number) => {
          if (depth >= maxD || lines.length > 400) return;
          let entries: string[];
          try {
            entries = readdirSync(dir).filter((n) => !IGNORE_DIRS.has(n));
          } catch {
            return;
          }
          entries.sort((a, b) => a.localeCompare(b));
          entries.forEach((name, i) => {
            const last = i === entries.length - 1;
            const full = join(dir, name);
            let isDir = false;
            try {
              isDir = statSync(full).isDirectory();
            } catch {
              return;
            }
            lines.push(`${prefix}${last ? "└── " : "├── "}${name}${isDir ? "/" : ""}`);
            if (isDir) walk(full, prefix + (last ? "    " : "│   "), depth + 1);
          });
        };
        walk(root, "", 0);
        return ok(lines.join("\n"));
      } catch (e) {
        return fail(String(e));
      }
    },
  };

  const search_files: ToolDefinition = {
    name: "search_files",
    description:
      "Fuzzy-ish filename search: finds files whose path contains the query (case-insensitive).",
    readOnly: true,
    requiresApproval: false,
    parameters: {
      type: "object",
      properties: {
        query: { type: "string" },
        path: { type: "string" },
        max_results: { type: "number" },
      },
      required: ["query"],
    },
    execute: ({ query, path, max_results }) => {
      const q = String(query || "").toLowerCase();
      if (!q) return fail("Empty query");
      const base = ws.resolve(String(path || "."));
      const max = Math.min(Number(max_results) || 50, 200);
      const hits: string[] = [];
      const walk = (dir: string) => {
        if (hits.length >= max) return;
        let entries: string[];
        try {
          entries = readdirSync(dir);
        } catch {
          return;
        }
        for (const name of entries) {
          if (IGNORE_DIRS.has(name)) continue;
          const full = join(dir, name);
          let st;
          try {
            st = statSync(full);
          } catch {
            continue;
          }
          if (st.isDirectory()) walk(full);
          else {
            const rel = ws.rel(full).replace(/\\/g, "/");
            if (rel.toLowerCase().includes(q) || name.toLowerCase().includes(q)) {
              hits.push(rel);
              if (hits.length >= max) return;
            }
          }
        }
      };
      walk(base);
      return ok(`${hits.length} file(s) matching ${JSON.stringify(query)}:\n${hits.join("\n") || "(none)"}`);
    },
  };

  const diagnostics: ToolDefinition = {
    name: "diagnostics",
    description:
      "Run project diagnostics: detect stack and execute typecheck/lint/test commands if present (read-only intent; may execute package scripts).",
    readOnly: false,
    requiresApproval: true,
    parameters: {
      type: "object",
      properties: {
        mode: {
          type: "string",
          description: "auto | typecheck | lint | test",
          enum: ["auto", "typecheck", "lint", "test"],
        },
      },
    },
    execute: async ({ mode }) => {
      const m = String(mode || "auto");
      const root = ws.root;
      const has = (f: string) => existsSync(join(root, f));
      const cmds: string[] = [];

      if (has("package.json")) {
        try {
          const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
          const scripts = pkg.scripts || {};
          if (m === "typecheck" || m === "auto") {
            if (scripts.typecheck) cmds.push("npm run typecheck --if-present");
            else if (scripts["type-check"]) cmds.push("npm run type-check --if-present");
            else if (has("tsconfig.json")) cmds.push("npx --yes tsc --noEmit");
          }
          if (m === "lint" || m === "auto") {
            if (scripts.lint) cmds.push("npm run lint --if-present");
          }
          if (m === "test" || (m === "auto" && cmds.length === 0)) {
            if (scripts.test) cmds.push("npm test --if-present");
          }
        } catch {
          /* */
        }
      }
      if (has("pyproject.toml") || has("requirements.txt")) {
        if (m === "test" || m === "auto") {
          if (has("pytest.ini") || has("tests")) cmds.push("python -m pytest -q");
        }
      }
      if (has("Cargo.toml") && (m === "test" || m === "auto")) {
        cmds.push("cargo test --quiet");
      }
      if (has("go.mod") && (m === "test" || m === "auto")) {
        cmds.push("go test ./...");
      }
      if (!cmds.length) {
        return ok(
          "No diagnostics commands detected. Stack markers: " +
            [
              has("package.json") && "node",
              has("pyproject.toml") && "python",
              has("Cargo.toml") && "rust",
              has("go.mod") && "go",
            ]
              .filter(Boolean)
              .join(", "),
        );
      }
      const out: string[] = [];
      for (const c of cmds.slice(0, 3)) {
        const r = await run(c, root, 180);
        out.push(`$ ${c}\nexit=${r.code}\n${r.stdout.slice(-8000)}\n${r.stderr.slice(-4000)}`);
      }
      const text = out.join("\n---\n");
      const failed = out.some((o) => /exit=[1-9]/.test(o));
      return failed ? fail("Diagnostics reported failures", text) : ok(text);
    },
  };

  const notebook_read: ToolDefinition = {
    name: "notebook_read",
    description: "Read a Jupyter .ipynb notebook as ordered cells (source only).",
    readOnly: true,
    requiresApproval: false,
    parameters: {
      type: "object",
      properties: {
        path: { type: "string" },
        max_cells: { type: "number" },
      },
      required: ["path"],
    },
    execute: ({ path, max_cells }) => {
      try {
        const fp = ws.resolve(String(path));
        if (!existsSync(fp)) return fail("Not found");
        const nb = JSON.parse(readFileSync(fp, "utf8"));
        const cells = Array.isArray(nb.cells) ? nb.cells : [];
        const max = Math.min(Number(max_cells) || 40, 100);
        const lines: string[] = [`Notebook ${ws.rel(fp)} — ${cells.length} cells`];
        cells.slice(0, max).forEach((c: { cell_type?: string; source?: string | string[] }, i: number) => {
          const src = Array.isArray(c.source) ? c.source.join("") : String(c.source || "");
          lines.push(`\n--- cell ${i} (${c.cell_type || "?"}) ---\n${src.slice(0, 3000)}`);
        });
        return ok(lines.join("\n"));
      } catch (e) {
        return fail(String(e));
      }
    },
  };

  const memory_append: ToolDefinition = {
    name: "memory_append",
    description:
      "Append a durable note to ~/.arrowcode/memory/session.md for later turns (project-agnostic).",
    readOnly: false,
    requiresApproval: false,
    parameters: {
      type: "object",
      properties: {
        note: { type: "string" },
        tag: { type: "string" },
      },
      required: ["note"],
    },
    execute: ({ note, tag }) => {
      try {
        // Optional global memory — only if ~/.arrowcode already exists
        if (!existsSync(MEMORY_DIR) && !existsSync(join(MEMORY_DIR, ".."))) {
          return fail("No ~/.arrowcode yet. Use /session memory for workspace session notes, or run --init.");
        }
        mkdirSync(MEMORY_DIR, { recursive: true });
        const file = join(MEMORY_DIR, "session.md");
        const line = `\n## ${new Date().toISOString()}${tag ? ` [${tag}]` : ""}\n${String(note).slice(0, 4000)}\n`;
        appendFileSync(file, line, "utf8");
        return ok(`Appended to ${file}`);
      } catch (e) {
        return fail(String(e));
      }
    },
  };

  const memory_read: ToolDefinition = {
    name: "memory_read",
    description: "Read durable memory notes from ~/.arrowcode/memory/session.md",
    readOnly: true,
    requiresApproval: false,
    parameters: {
      type: "object",
      properties: {
        limit_chars: { type: "number" },
      },
    },
    execute: ({ limit_chars }) => {
      try {
        const file = join(MEMORY_DIR, "session.md");
        if (!existsSync(file)) return ok("(no memory yet)");
        const text = readFileSync(file, "utf8");
        const lim = Math.min(Number(limit_chars) || 12_000, 40_000);
        return ok(text.length > lim ? text.slice(-lim) : text);
      } catch (e) {
        return fail(String(e));
      }
    },
  };

  const diff_workspace: ToolDefinition = {
    name: "diff_workspace",
    description: "Show git diff (unstaged+staged summary) for the workspace.",
    readOnly: true,
    requiresApproval: false,
    parameters: {
      type: "object",
      properties: {
        staged: { type: "boolean" },
        path: { type: "string" },
      },
    },
    execute: async ({ staged, path }) => {
      const args = staged ? "git diff --cached" : "git diff HEAD";
      const p = path ? ` -- ${path}` : "";
      const r = await run(args + p, ws.root, 30);
      const text = (r.stdout || r.stderr || "(empty diff)").slice(0, 40_000);
      return ok(text);
    },
  };

  const find_symbol: ToolDefinition = {
    name: "find_symbol",
    description:
      "Find likely definitions of a symbol (function/class/const) via regex across the repo.",
    readOnly: true,
    requiresApproval: false,
    parameters: {
      type: "object",
      properties: {
        symbol: { type: "string" },
        path: { type: "string" },
        max_results: { type: "number" },
      },
      required: ["symbol"],
    },
    execute: ({ symbol, path, max_results }) => {
      const sym = String(symbol || "").trim();
      if (!sym) return fail("Empty symbol");
      const patterns = [
        new RegExp(`\\b(function|class|def|fn|func|interface|type|const|let|var|struct|enum)\\s+${escapeRe(sym)}\\b`),
        new RegExp(`\\b${escapeRe(sym)}\\s*[=:]\\s*(async\\s*)?(\\(|function|class)`),
        new RegExp(`\\bexport\\s+(default\\s+)?(async\\s+)?(function|class|const)\\s+${escapeRe(sym)}\\b`),
      ];
      const base = ws.resolve(String(path || "."));
      const max = Math.min(Number(max_results) || 40, 100);
      const hits: string[] = [];
      const walk = (dir: string) => {
        if (hits.length >= max) return;
        let entries: string[];
        try {
          entries = readdirSync(dir);
        } catch {
          return;
        }
        for (const name of entries) {
          if (IGNORE_DIRS.has(name)) continue;
          const full = join(dir, name);
          let st;
          try {
            st = statSync(full);
          } catch {
            continue;
          }
          if (st.isDirectory()) walk(full);
          else {
            if (BINARY_EXT.has(extname(full).toLowerCase())) continue;
            let text: string;
            try {
              const buf = readFileSync(full);
              if (buf.includes(0)) return;
              text = buf.toString("utf8");
            } catch {
              continue;
            }
            const lines = text.split(/\r?\n/);
            for (let i = 0; i < lines.length; i++) {
              if (patterns.some((rx) => rx.test(lines[i]!))) {
                hits.push(`${ws.rel(full)}:${i + 1}:${lines[i]!.slice(0, 200)}`);
                if (hits.length >= max) return;
              }
            }
          }
        }
      };
      walk(base);
      return ok(
        `${hits.length} definition-like hit(s) for ${JSON.stringify(sym)}:\n${hits.join("\n") || "(none)"}`,
      );
    },
  };

  return [
    multi_edit,
    delete_file,
    move_file,
    tree,
    search_files,
    diagnostics,
    notebook_read,
    memory_append,
    memory_read,
    diff_workspace,
    find_symbol,
  ];
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
