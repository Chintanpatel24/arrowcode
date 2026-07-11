import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  readdirSync,
  statSync,
  unlinkSync,
} from "node:fs";
import { join, dirname, basename, extname } from "node:path";
import { spawn } from "node:child_process";
import type { ToolDefinition, ToolResult } from "./types";
import { Workspace, IGNORE_DIRS, BINARY_EXT } from "./workspace";
import { buildExtraTools } from "./extra";
import { perfCaches, invalidateFileCaches } from "../perf/cache";
import { perf } from "../perf/timers";

function ok(output: string, metadata?: Record<string, unknown>): ToolResult {
  return { success: true, output, metadata };
}
function fail(error: string, output = ""): ToolResult {
  return { success: false, output, error };
}

async function runShell(
  command: string,
  cwd: string,
  timeoutSec: number,
): Promise<{ code: number; stdout: string; stderr: string; ms: number }> {
  const start = Date.now();
  return new Promise((resolve) => {
    const child = spawn(command, {
      shell: true,
      cwd,
      env: { ...process.env, TERM: "dumb", PAGER: "cat", GIT_PAGER: "cat" },
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      resolve({
        code: 124,
        stdout: stdout.slice(-40_000),
        stderr: (stderr + `\n[timeout after ${timeoutSec}s]`).slice(-20_000),
        ms: Date.now() - start,
      });
    }, timeoutSec * 1000);

    child.stdout?.on("data", (d) => {
      stdout += d.toString();
      if (stdout.length > 200_000) stdout = stdout.slice(-100_000);
    });
    child.stderr?.on("data", (d) => {
      stderr += d.toString();
      if (stderr.length > 100_000) stderr = stderr.slice(-50_000);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({
        code: code ?? 1,
        stdout: stdout.slice(-40_000),
        stderr: stderr.slice(-20_000),
        ms: Date.now() - start,
      });
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({
        code: 1,
        stdout: "",
        stderr: String(err),
        ms: Date.now() - start,
      });
    });
  });
}

export interface ToolContext {
  workspace: Workspace;
  todos: { id: string; content: string; status: string; owner?: string }[];
  bus?: {
    send: (msg: {
      to: string;
      kind: string;
      title: string;
      body: string;
    }) => void;
  };
  agentId?: string;
  /** Spawn a swarm worker under this agent */
  spawnWorker?: (opts: {
    role: string;
    task: string;
  }) => { ok: true; id: string } | { ok: false; error: string };
  swarmStatus?: () => string;
  /** Optional file touch tracker for dashboard */
  trackFile?: (
    kind: "read" | "write" | "edit" | "delete" | "move",
    path: string,
    contentAfter?: string,
  ) => void;
}

export function buildTools(ctx: ToolContext): ToolDefinition[] {
  const ws = ctx.workspace;

  const read_file: ToolDefinition = {
    name: "read_file",
    description:
      "Read a text file from the workspace. Optional offset/limit are 1-indexed line numbers.",
    readOnly: true,
    requiresApproval: false,
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "File path relative to workspace" },
        offset: { type: "number", description: "Start line (1-indexed)" },
        limit: { type: "number", description: "Max lines" },
      },
      required: ["path"],
    },
    execute: ({ path, offset, limit }) => {
      try {
        const fp = ws.resolve(String(path), { mustExist: true });
        if (!existsSync(fp)) return fail(`Not found: ${path}`);
        const st = statSync(fp);
        if (st.isDirectory()) return fail(`${path} is a directory — use list_dir`);
        if (BINARY_EXT.has(extname(fp).toLowerCase()))
          return fail(`Binary file refused (${extname(fp)})`);
        const raw = readFileSync(fp);
        if (raw.includes(0)) return fail("File looks binary (NUL bytes)");
        const cacheKey = `rf:${fp}:${raw.length}`;
        let text = perfCaches.fileContent.get(cacheKey);
        if (!text) {
          text = raw.toString("utf8");
          perfCaches.fileContent.set(cacheKey, text);
          perf.inc("cache.file.miss");
        } else {
          perf.inc("cache.file.hit");
        }
        const lines = text.split(/\r?\n/);
        const total = lines.length;
        let start = offset != null ? Math.max(1, Number(offset)) : 1;
        let end =
          limit != null
            ? Math.min(total, start + Math.max(0, Number(limit)) - 1)
            : total > 2000 && offset == null
              ? 2000
              : total;
        const slice = lines.slice(start - 1, end);
        const numbered = slice.map((l, i) => `${String(i + start).padStart(6)}|${l}`);
        let body = numbered.join("\n");
        if (end < total)
          body += `\n\n[lines ${start}-${end} of ${total}]`;
        return ok(`File: ${ws.rel(fp)} (${total} lines)\n${body}`, {
          path: fp,
          lines: total,
        });
      } catch (e) {
        return fail(String(e));
      }
    },
  };

  const write_file: ToolDefinition = {
    name: "write_file",
    description:
      "Create or overwrite a file with full content. Creates parent dirs. Prefer edit_file for small changes.",
    readOnly: false,
    requiresApproval: true,
    parameters: {
      type: "object",
      properties: {
        path: { type: "string" },
        content: { type: "string" },
      },
      required: ["path", "content"],
    },
    execute: ({ path, content }) => {
      try {
        const fp = ws.resolve(String(path));
        mkdirSync(dirname(fp), { recursive: true });
        const c = content == null ? "" : String(content);
        writeFileSync(fp, c, "utf8");
        invalidateFileCaches(fp);
        ctx.trackFile?.("write", ws.rel(fp), c);
        return ok(
          `Wrote ${ws.rel(fp)} (${c.length} bytes, ~${c.split("\n").length} lines)`,
        );
      } catch (e) {
        return fail(String(e));
      }
    },
  };

  const edit_file: ToolDefinition = {
    name: "edit_file",
    description:
      "Replace old_text with new_text in a file. old_text must match once unless replace_all=true.",
    readOnly: false,
    requiresApproval: true,
    parameters: {
      type: "object",
      properties: {
        path: { type: "string" },
        old_text: { type: "string" },
        new_text: { type: "string" },
        replace_all: { type: "boolean" },
      },
      required: ["path", "old_text", "new_text"],
    },
    execute: ({ path, old_text, new_text, replace_all }) => {
      try {
        const fp = ws.resolve(String(path));
        if (!existsSync(fp)) return fail(`Not found: ${path}`);
        let original = readFileSync(fp, "utf8");
        const oldT = String(old_text);
        const newT = String(new_text ?? "");
        if (!original.includes(oldT)) {
          const alt = original.replace(/\r\n/g, "\n");
          const oldN = oldT.replace(/\r\n/g, "\n");
          if (alt.includes(oldN)) {
            original = alt;
            const count = alt.split(oldN).length - 1;
            if (count > 1 && !replace_all)
              return fail(
                `old_text matched ${count} times. Provide more context or replace_all=true.`,
              );
            const updated = replace_all
              ? alt.split(oldN).join(newT)
              : alt.replace(oldN, newT);
            writeFileSync(fp, updated, "utf8");
            ctx.trackFile?.("edit", ws.rel(fp), updated);
            return ok(
              `Edited ${ws.rel(fp)} — ${replace_all ? count : 1} replacement(s).`,
            );
          }
          return fail("old_text not found. Read the file and use exact text.");
        }
        const count = original.split(oldT).length - 1;
        if (count > 1 && !replace_all)
          return fail(
            `old_text matched ${count} times. Provide more context or replace_all=true.`,
          );
        const updated = replace_all
          ? original.split(oldT).join(newT)
          : original.replace(oldT, newT);
        writeFileSync(fp, updated, "utf8");
        invalidateFileCaches(fp);
        ctx.trackFile?.("edit", ws.rel(fp), updated);
        return ok(
          `Edited ${ws.rel(fp)} — ${replace_all ? count : 1} replacement(s).`,
        );
      } catch (e) {
        return fail(String(e));
      }
    },
  };

  const list_dir: ToolDefinition = {
    name: "list_dir",
    description: "List files/directories. Optional recursive + max_depth + glob-like pattern on names.",
    readOnly: true,
    requiresApproval: false,
    parameters: {
      type: "object",
      properties: {
        path: { type: "string" },
        recursive: { type: "boolean" },
        max_depth: { type: "number" },
        pattern: { type: "string" },
      },
    },
    execute: ({ path, recursive, max_depth, pattern }) => {
      try {
        const d = ws.resolve(String(path || "."));
        if (!existsSync(d) || !statSync(d).isDirectory())
          return fail(`Not a directory: ${path || "."}`);
        const lines: string[] = [];
        const maxEntries = 500;
        const depthLimit = max_depth != null ? Number(max_depth) : 3;
        const pat = pattern ? String(pattern) : null;

        const match = (name: string) => {
          if (!pat) return true;
          // simple glob: * and ?
          const re = new RegExp(
            "^" +
              pat
                .replace(/[.+^${}()|[\]\\]/g, "\\$&")
                .replace(/\*/g, ".*")
                .replace(/\?/g, ".") +
              "$",
          );
          return re.test(name);
        };

        const walk = (cur: string, depth: number) => {
          if (lines.length >= maxEntries) return;
          let entries: string[];
          try {
            entries = readdirSync(cur);
          } catch {
            return;
          }
          entries.sort((a, b) => a.localeCompare(b));
          for (const name of entries) {
            if (lines.length >= maxEntries) {
              lines.push("... (truncated)");
              return;
            }
            if (IGNORE_DIRS.has(name)) continue;
            const full = join(cur, name);
            let isDir = false;
            try {
              isDir = statSync(full).isDirectory();
            } catch {
              continue;
            }
            if (!isDir && !match(name)) continue;
            const rel = ws.rel(full);
            if (isDir) {
              lines.push(`${rel}/`);
              if (recursive && depth < depthLimit) walk(full, depth + 1);
            } else {
              let size = 0;
              try {
                size = statSync(full).size;
              } catch {
                /* */
              }
              lines.push(`${rel}  (${size} B)`);
            }
          }
        };
        walk(d, 0);
        return ok(`Listing ${ws.rel(d)} (${lines.length} entries)\n${lines.join("\n")}`);
      } catch (e) {
        return fail(String(e));
      }
    },
  };

  const glob_tool: ToolDefinition = {
    name: "glob",
    description: "Find files by glob pattern under workspace (e.g. **/*.ts, src/**/*.tsx).",
    readOnly: true,
    requiresApproval: false,
    parameters: {
      type: "object",
      properties: {
        pattern: { type: "string" },
        path: { type: "string" },
      },
      required: ["pattern"],
    },
    execute: ({ pattern, path }) => {
      try {
        const base = ws.resolve(String(path || "."));
        const pat = String(pattern).replace(/^\//, "");
        const matches: string[] = [];

        // Convert glob to regex (support ** * ?)
        const toRe = (g: string) => {
          let s = "";
          for (let i = 0; i < g.length; i++) {
            if (g[i] === "*" && g[i + 1] === "*") {
              s += ".*";
              i++;
              if (g[i + 1] === "/") i++;
            } else if (g[i] === "*") s += "[^/]*";
            else if (g[i] === "?") s += "[^/]";
            else if ("+.^${}()|[]\\".includes(g[i]!)) s += "\\" + g[i];
            else s += g[i];
          }
          return new RegExp("^" + s + "$");
        };
        const re = toRe(pat);

        const walk = (cur: string) => {
          if (matches.length >= 400) return;
          let entries: string[];
          try {
            entries = readdirSync(cur);
          } catch {
            return;
          }
          for (const name of entries) {
            if (IGNORE_DIRS.has(name)) continue;
            const full = join(cur, name);
            let st;
            try {
              st = statSync(full);
            } catch {
              continue;
            }
            if (st.isDirectory()) walk(full);
            else {
              const rel = ws.rel(full).replace(/\\/g, "/");
              if (re.test(rel) || re.test(name)) {
                matches.push(rel);
                if (matches.length >= 400) {
                  matches.push("... (truncated at 400)");
                  return;
                }
              }
            }
          }
        };
        walk(base);
        matches.sort();
        const n = matches.filter((m) => !m.startsWith("...")).length;
        return ok(`${n} matches for ${JSON.stringify(pattern)}:\n${matches.join("\n")}`);
      } catch (e) {
        return fail(String(e));
      }
    },
  };

  const grep_tool: ToolDefinition = {
    name: "grep",
    description: "Regex search across files. Returns path:line:content.",
    readOnly: true,
    requiresApproval: false,
    parameters: {
      type: "object",
      properties: {
        pattern: { type: "string" },
        path: { type: "string" },
        glob: { type: "string" },
        case_insensitive: { type: "boolean" },
        max_results: { type: "number" },
      },
      required: ["pattern"],
    },
    execute: ({ pattern, path, glob, case_insensitive, max_results }) => {
      try {
        const target = ws.resolve(String(path || "."));
        let rx: RegExp;
        try {
          rx = new RegExp(
            String(pattern),
            case_insensitive ? "i" : "",
          );
        } catch (e) {
          return fail(`Invalid regex: ${e}`);
        }
        const hits: string[] = [];
        let scanned = 0;
        const max = Math.min(Number(max_results) || 100, 500);
        const gpat = glob ? String(glob) : null;
        const nameOk = (name: string) => {
          if (!gpat) return true;
          const re = new RegExp(
            "^" +
              gpat
                .replace(/[.+^${}()|[\]\\]/g, "\\$&")
                .replace(/\*/g, ".*")
                .replace(/\?/g, ".") +
              "$",
          );
          return re.test(name);
        };

        const searchFile = (fp: string) => {
          if (hits.length >= max) return;
          const name = basename(fp);
          if (!nameOk(name)) return;
          if (BINARY_EXT.has(extname(fp).toLowerCase())) return;
          scanned++;
          let text: string;
          try {
            const buf = readFileSync(fp);
            if (buf.includes(0)) return;
            text = buf.toString("utf8");
          } catch {
            return;
          }
          const lines = text.split(/\r?\n/);
          for (let i = 0; i < lines.length; i++) {
            if (rx.test(lines[i]!)) {
              hits.push(`${ws.rel(fp)}:${i + 1}:${lines[i]!.slice(0, 300)}`);
              if (hits.length >= max) return;
            }
          }
        };

        const walk = (cur: string) => {
          if (hits.length >= max) return;
          let st;
          try {
            st = statSync(cur);
          } catch {
            return;
          }
          if (st.isFile()) {
            searchFile(cur);
            return;
          }
          let entries: string[];
          try {
            entries = readdirSync(cur);
          } catch {
            return;
          }
          for (const name of entries) {
            if (IGNORE_DIRS.has(name)) continue;
            walk(join(cur, name));
            if (hits.length >= max) return;
          }
        };
        walk(target);
        const header = `${hits.length} match(es) in ${scanned} file(s) for /${pattern}/`;
        return ok(`${header}\n${hits.length ? hits.join("\n") : "(no matches)"}`);
      } catch (e) {
        return fail(String(e));
      }
    },
  };

  const bash: ToolDefinition = {
    name: "bash",
    description:
      "Run a shell command in the workspace. Prefer specialized file tools for simple edits. Killed after timeout_seconds.",
    readOnly: false,
    requiresApproval: true,
    parameters: {
      type: "object",
      properties: {
        command: { type: "string" },
        timeout_seconds: { type: "number" },
        cwd: { type: "string" },
      },
      required: ["command"],
    },
    execute: async ({ command, timeout_seconds, cwd }) => {
      const cmd = String(command || "").trim();
      if (!cmd) return fail("Empty command");
      const blocked = [
        /rm\s+-rf\s+\/($|\s)/,
        /mkfs\./,
        /dd\s+if=.*of=\/dev\//,
      ];
      for (const b of blocked) {
        if (b.test(cmd)) return fail(`Blocked dangerous pattern: ${b}`);
      }
      let work = ws.root;
      if (cwd) {
        try {
          work = ws.resolve(String(cwd));
        } catch (e) {
          return fail(String(e));
        }
      }
      const timeout = Math.max(1, Math.min(Number(timeout_seconds) || 120, 600));
      const r = await runShell(cmd, work, timeout);
      const parts = [
        `$ ${cmd}`,
        `cwd: ${ws.rel(work)}  exit=${r.code}  (${(r.ms / 1000).toFixed(2)}s)`,
      ];
      if (r.stdout) parts.push("--- stdout ---\n" + r.stdout);
      if (r.stderr) parts.push("--- stderr ---\n" + r.stderr);
      const text = parts.join("\n");
      if (r.code === 0) return ok(text, { exit_code: r.code });
      return { success: false, output: text, error: `exit code ${r.code}` };
    },
  };

  const git_status: ToolDefinition = {
    name: "git_status",
    description: "Show branch, status, recent log, and diff stat.",
    readOnly: true,
    requiresApproval: false,
    parameters: { type: "object", properties: {} },
    execute: async () => {
      const run = async (args: string) => {
        const r = await runShell(args, ws.root, 30);
        return (r.stdout || r.stderr || "").trim();
      };
      const branch = await run("git rev-parse --abbrev-ref HEAD");
      const status = await run("git status --short --branch");
      const log = await run("git log -5 --oneline --decorate");
      const diff = await run("git diff --stat HEAD");
      return ok(
        [
          `branch: ${branch}`,
          "",
          "=== status ===",
          status || "(clean)",
          "",
          "=== recent commits ===",
          log || "(none)",
          "",
          "=== diff stat ===",
          diff || "(no diff vs HEAD)",
        ].join("\n"),
      );
    },
  };

  const think: ToolDefinition = {
    name: "think",
    description: "Private scratchpad for planning. Does not change the system.",
    readOnly: true,
    requiresApproval: false,
    parameters: {
      type: "object",
      properties: {
        thought: { type: "string" },
      },
      required: ["thought"],
    },
    execute: ({ thought }) => ok(`Noted.\n${String(thought).slice(0, 4000)}`),
  };

  const todo_write: ToolDefinition = {
    name: "todo_write",
    description: "Create/update structured task list for multi-step work.",
    readOnly: false,
    requiresApproval: false,
    parameters: {
      type: "object",
      properties: {
        todos: {
          type: "array",
          description: "Todo items",
          items: {
            type: "object",
            properties: {
              id: { type: "string" },
              content: { type: "string" },
              status: {
                type: "string",
                enum: ["pending", "in_progress", "completed", "cancelled"],
              },
              owner: { type: "string" },
            },
          },
        },
      },
      required: ["todos"],
    },
    execute: ({ todos }) => {
      const list = Array.isArray(todos) ? todos : [];
      ctx.todos.length = 0;
      for (const t of list as {
        id: string;
        content: string;
        status: string;
        owner?: string;
      }[]) {
        ctx.todos.push({
          id: String(t.id),
          content: String(t.content),
          status: String(t.status || "pending"),
          owner: t.owner,
        });
      }
      const lines = ctx.todos.map((t) => {
        const mark =
          t.status === "completed"
            ? "[x]"
            : t.status === "in_progress"
              ? "[>]"
              : t.status === "cancelled"
                ? "[-]"
                : "[ ]";
        return `${mark} ${t.id}${t.owner ? " @" + t.owner : ""}: ${t.content}`;
      });
      return ok("Todos updated:\n" + lines.join("\n"));
    },
  };

  const message_agent: ToolDefinition = {
    name: "message_agent",
    description:
      "Send a structured message to another agent or worker. to: orchestrator|frontend|backend|tester|all|worker-id",
    readOnly: false,
    requiresApproval: false,
    parameters: {
      type: "object",
      properties: {
        to: {
          type: "string",
          description:
            "orchestrator | frontend | backend | tester | all | <worker id>",
        },
        kind: {
          type: "string",
          enum: ["task", "result", "note", "block", "done", "report"],
        },
        title: { type: "string" },
        body: { type: "string" },
      },
      required: ["to", "kind", "title", "body"],
    },
    execute: ({ to, kind, title, body }) => {
      if (!ctx.bus) return fail("Message bus not available");
      ctx.bus.send({
        to: String(to),
        kind: String(kind),
        title: String(title),
        body: String(body),
      });
      return ok(`Queued ${kind} -> ${to}: ${title}`);
    },
  };

  const spawn_worker: ToolDefinition = {
    name: "spawn_worker",
    description:
      "Spawn a swarm sub-agent under you for a focused subtask. Workers share the workspace and report back when done. Respects max depth/workers.",
    readOnly: false,
    requiresApproval: false,
    parameters: {
      type: "object",
      properties: {
        role: {
          type: "string",
          description: "Short role label e.g. form-ui, auth-api, unit-tests",
        },
        task: {
          type: "string",
          description: "Clear task description with acceptance criteria",
        },
      },
      required: ["role", "task"],
    },
    execute: ({ role, task }) => {
      if (!ctx.spawnWorker) return fail("Swarm spawn not available on this agent");
      const r = ctx.spawnWorker({
        role: String(role || "worker"),
        task: String(task || ""),
      });
      if (!r.ok) return fail(r.error);
      return ok(
        `Spawned worker ${r.id}\nrole: ${role}\nIt will report via the bus when finished.`,
        { workerId: r.id },
      );
    },
  };

  const swarm_status: ToolDefinition = {
    name: "swarm_status",
    description: "Show active swarm workers, depth caps, and parent/child tree.",
    readOnly: true,
    requiresApproval: false,
    parameters: { type: "object", properties: {} },
    execute: () => {
      if (!ctx.swarmStatus) return ok("Swarm status unavailable");
      return ok(ctx.swarmStatus());
    },
  };

  const web_fetch: ToolDefinition = {
    name: "web_fetch",
    description: "Fetch a URL and return text content (HTML tags stripped). Needs network.",
    readOnly: true,
    requiresApproval: true,
    parameters: {
      type: "object",
      properties: {
        url: { type: "string" },
      },
      required: ["url"],
    },
    execute: async ({ url }) => {
      const u = String(url || "");
      if (!/^https?:\/\//i.test(u)) return fail("URL must be http(s)");
      try {
        const res = await fetch(u, {
          headers: { "User-Agent": "arrowcode/1.0" },
          signal: AbortSignal.timeout(30_000),
        });
        if (!res.ok) return fail(`HTTP ${res.status}`);
        let text = await res.text();
        const ct = res.headers.get("content-type") || "";
        if (ct.includes("html") || /^\s*<!doctype/i.test(text) || /^\s*<html/i.test(text)) {
          text = text
            .replace(/<script[\s\S]*?<\/script>/gi, " ")
            .replace(/<style[\s\S]*?<\/style>/gi, " ")
            .replace(/<[^>]+>/g, " ")
            .replace(/\s+/g, " ");
        }
        if (text.length > 100_000) text = text.slice(0, 100_000) + "\n...[truncated]";
        return ok(`URL: ${u}\n\n${text}`);
      } catch (e) {
        return fail(String(e));
      }
    },
  };

  return [
    read_file,
    write_file,
    edit_file,
    list_dir,
    glob_tool,
    grep_tool,
    bash,
    git_status,
    think,
    todo_write,
    message_agent,
    spawn_worker,
    swarm_status,
    web_fetch,
    ...buildExtraTools(ws),
  ];
}
