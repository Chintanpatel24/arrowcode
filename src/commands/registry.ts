import type { Harness } from "../core/harness";
import { listAgentPersonalityPaths, loadAgentPersonality } from "../agents/personalities";
import { AGENT_META, AGENT_ORDER } from "../config/types";
import { AGENTS_DIR } from "../config/paths";
import { seedAgentPersonalities } from "../agents/personalities";
import { seedTemplates } from "../templates/catalog";
import { resolveEndpoint } from "../config/load";
import { bootstrapUserHome } from "../bootstrap/install-home";
import { perf } from "../perf/timers";
import { perfCaches } from "../perf/cache";

export type CommandResult =
  | { type: "ok"; message?: string }
  | { type: "error"; message: string }
  | { type: "exit" }
  | { type: "open_settings" }
  | { type: "open_help" }
  | { type: "open_goal" }
  | { type: "open_plan" }
  | { type: "open_agents" }
  | { type: "open_templates" };

export interface CommandContext {
  harness: Harness;
  setYolo?: (v: boolean) => void;
  getYolo?: () => boolean;
}

export function listCommands(): { cmd: string; help: string }[] {
  return [
    { cmd: "/help", help: "Show commands" },
    { cmd: "/plan [goal]", help: "Start plan -> questions (no execute yet)" },
    { cmd: "/confirm", help: "Confirm plan and start execute loop" },
    { cmd: "/reject [note]", help: "Reject ready result and continue" },
    { cmd: "/accept [note]", help: "Accept goal and stop loop" },
    { cmd: "/stop", help: "Halt execute loop" },
    { cmd: "/execute", help: "Alias of /confirm" },
    { cmd: "/review [note]", help: "QA-focused review pass (tests preferred)" },
    { cmd: "/undo [id]", help: "Restore last checkpoint (or id)" },
    { cmd: "/checkpoints", help: "List workspace checkpoints" },
    { cmd: "/dryrun [on|off]", help: "Block writes/bash (allowlist still runs)" },
    { cmd: "/budget [n]", help: "Token budget soft stop (0=off)" },
    { cmd: "/allowlist [on|off]", help: "Auto-approve safe bash commands" },
    { cmd: "/secretscan [on|off]", help: "Block writes that look like secrets" },
    { cmd: "/settings", help: "Fullscreen settings" },
    { cmd: "/goal", help: "Show / set goal" },
    { cmd: "/templates [id]", help: "List or apply template" },
    { cmd: "/agents", help: "Personality paths" },
    { cmd: "/init", help: "Create ~/.arrowcode from defaults/ (install)" },
    { cmd: "/status", help: "Phase + agent statuses" },
    { cmd: "/model [id]", help: "Show or set model" },
    { cmd: "/yolo", help: "Toggle auto-approve all tools" },
    { cmd: "/clear", help: "Reset agents and phase" },
    { cmd: "/compact", help: "Soft history reset" },
    { cmd: "/cost", help: "Session metrics" },
    { cmd: "/swarm", help: "Swarm tree" },
    { cmd: "/endpoints", help: "Per-agent endpoints" },
    { cmd: "/dashboard", help: "Refresh panels" },
    { cmd: "/diff", help: "Refresh file diffs" },
    { cmd: "/replay [name]", help: "Export session timeline" },
    { cmd: "/session new [name]", help: "Create workspace session" },
    { cmd: "/session list", help: "List sessions in this workspace" },
    { cmd: "/session load <id>", help: "Resume a session" },
    { cmd: "/session save", help: "Persist active session" },
    { cmd: "/session memory [note]", help: "Show or append durable memory" },
    { cmd: "/session delete <id>", help: "Delete a session" },
    { cmd: "/sessions", help: "Alias of /session list" },
    { cmd: "/perf", help: "Show lightning perf timers/counters" },
    { cmd: "/perf reset", help: "Reset perf counters" },
    { cmd: "/exit", help: "Quit" },
  ];
}

function onOff(arg: string, cur: boolean): boolean {
  const a = arg.trim().toLowerCase();
  if (a === "on" || a === "1" || a === "true") return true;
  if (a === "off" || a === "0" || a === "false") return false;
  return !cur;
}

export async function dispatchCommand(
  line: string,
  ctx: CommandContext,
): Promise<CommandResult> {
  const raw = line.trim();
  if (!raw.startsWith("/")) {
    return { type: "error", message: "Not a command" };
  }
  const parts = raw.slice(1).split(/\s+/);
  const cmd = (parts[0] || "").toLowerCase();
  const arg = raw.slice(1 + cmd.length).trim();
  const h = ctx.harness;

  switch (cmd) {
    case "help":
    case "h":
    case "?":
      return { type: "open_help" };

    case "exit":
    case "quit":
    case "q":
      h.stop();
      return { type: "exit" };

    case "settings":
    case "config":
      return { type: "open_settings" };

    case "goal":
      if (arg) {
        h.setGoalText(arg, h.config.templateId);
        return { type: "ok", message: "Goal updated." };
      }
      return { type: "open_goal" };

    case "plan":
      await h.startPlan(arg || h.goal?.text || "Improve the project");
      return { type: "ok", message: "Planning started." };

    case "confirm":
    case "execute":
    case "run":
      void h.confirmAndExecute();
      return { type: "ok", message: "Executing confirmed plan…" };

    case "reject":
      void h.rejectAndContinue(arg);
      return { type: "ok", message: "Continuing after reject." };

    case "accept":
    case "done":
      h.accept(arg);
      return { type: "ok", message: "Goal accepted." };

    case "stop":
    case "pause":
      h.stop();
      return { type: "ok", message: "Stopped." };

    case "review":
      void h.review(arg);
      return { type: "ok", message: "Review pass started (tester)." };

    case "undo":
      return { type: "ok", message: h.undo(arg || undefined) };

    case "checkpoints":
    case "cps": {
      const list = h.listCheckpoints();
      if (!list.length) return { type: "ok", message: "No checkpoints yet." };
      return {
        type: "ok",
        message: list
          .slice(-10)
          .map((c) => `${c.id}  ${c.label}  files=${c.files.length}`)
          .join("\n"),
      };
    }

    case "dryrun": {
      const next = onOff(arg, h.policy.dryRun);
      h.setPolicy({ dryRun: next });
      return { type: "ok", message: `dry-run ${next ? "ON" : "OFF"}` };
    }

    case "budget": {
      const n = arg.trim() === "" ? 0 : Number(arg);
      if (Number.isNaN(n) || n < 0)
        return { type: "error", message: "Usage: /budget 200000  (0=off)" };
      h.setPolicy({ tokenBudget: n });
      return {
        type: "ok",
        message: n ? `token budget ${n}` : "token budget OFF",
      };
    }

    case "allowlist": {
      const next = onOff(arg, h.policy.bashAllowlist);
      h.setPolicy({ bashAllowlist: next });
      return { type: "ok", message: `bash allowlist ${next ? "ON" : "OFF"}` };
    }

    case "secretscan": {
      const next = onOff(arg, h.policy.secretScan);
      h.setPolicy({ secretScan: next });
      return { type: "ok", message: `secret scan ${next ? "ON" : "OFF"}` };
    }

    case "templates":
    case "template":
      if (!arg) return { type: "open_templates" };
      h.applyTemplate(arg.split(/\s+/)[0]!);
      return { type: "ok", message: `Template: ${arg}` };

    case "agents":
      return { type: "open_agents" };

    case "init": {
      const r = bootstrapUserHome();
      seedAgentPersonalities();
      seedTemplates();
      return {
        type: "ok",
        message: r.createdHome
          ? `Created ${r.home} from defaults/`
          : `Home ready at ${r.home} (existing files kept)`,
      };
    }

    case "status": {
      const st = AGENT_ORDER.map(
        (id) => `${AGENT_META[id].short}:${h.agents.get(id)!.getStatus()}`,
      ).join("  ");
      return {
        type: "ok",
        message: `phase=${h.phase} cycle=${h.cycle} dryRun=${h.policy.dryRun} | ${st}`,
      };
    }

    case "model":
      if (!arg) {
        return { type: "ok", message: `model: ${h.config.model}` };
      }
      h.updateConfig({ model: arg });
      return { type: "ok", message: `model set to ${arg}` };

    case "yolo": {
      const next = !(ctx.getYolo?.() ?? h.config.autoApprove);
      h.setAutoApprove(next);
      ctx.setYolo?.(next);
      return {
        type: "ok",
        message: next ? "YOLO on" : "YOLO off",
      };
    }

    case "clear":
      h.resetAll();
      return { type: "ok", message: "Cleared." };

    case "compact":
      h.resetAll();
      return { type: "ok", message: "Histories reset (soft compact)." };

    case "cost": {
      return {
        type: "ok",
        message: h.metricsLine() + " | " + JSON.stringify(h.swarm.stats()),
      };
    }

    case "swarm": {
      const s = h.swarm.stats();
      return {
        type: "ok",
        message: `swarm maxWorkers=${s.maxWorkers} maxDepth=${s.maxDepth} active=${s.active} workers=${s.workers}\n${h.swarmTree()}`,
      };
    }

    case "endpoints": {
      const lines = AGENT_ORDER.map((id) => {
        const ep = resolveEndpoint(h.config, id);
        const key = ep.apiKey
          ? ep.apiKey.slice(0, 4) + "…" + ep.apiKey.slice(-3)
          : "(none)";
        return `${AGENT_META[id].short}: ${ep.provider} / ${ep.model} / key=${key}`;
      });
      return { type: "ok", message: lines.join("\n") };
    }

    case "sessions":
      return { type: "ok", message: h.sessionList() };

    case "perf": {
      if ((parts[1] || "").toLowerCase() === "reset") {
        perf.reset();
        perfCaches.fileContent.clear();
        perfCaches.listDir.clear();
        perfCaches.glob.clear();
        perfCaches.systemPrompt.clear();
        return { type: "ok", message: "Perf counters + caches cleared" };
      }
      const s = perf.summary();
      return {
        type: "ok",
        message:
          s +
          `\n  cache file=${perfCaches.fileContent.size} list=${perfCaches.listDir.size} prompt=${perfCaches.systemPrompt.size} personality=${perfCaches.personality.size}`,
      };
    }


    case "session": {
      const sub = (parts[1] || "list").toLowerCase();
      const rest = parts.slice(2).join(" ") || arg.replace(/^\S+\s*/, "");
      switch (sub) {
        case "new":
          return {
            type: "ok",
            message: `Created session ${h.sessionNew(rest || undefined)}`,
          };
        case "list":
        case "ls":
          return { type: "ok", message: h.sessionList() };
        case "load":
        case "open":
        case "resume":
          if (!rest)
            return { type: "error", message: "Usage: /session load <id>" };
          return { type: "ok", message: h.sessionLoad(rest.trim()) };
        case "save":
          return { type: "ok", message: h.sessionSave() };
        case "memory":
        case "mem":
          return { type: "ok", message: h.sessionMemory(rest || undefined) };
        case "delete":
        case "rm":
          if (!rest)
            return { type: "error", message: "Usage: /session delete <id>" };
          return { type: "ok", message: h.sessionDelete(rest.trim()) };
        default:
          // /session <id> => load
          if (parts[1])
            return { type: "ok", message: h.sessionLoad(parts[1]) };
          return { type: "ok", message: h.sessionList() };
      }
    }

    default:
      return { type: "error", message: `Unknown command: /${cmd}` };
  }
}

function seedAll() {
  seedAgentPersonalities();
  seedTemplates();
}

export function agentsInfo(h: Harness): string {
  const paths = listAgentPersonalityPaths();
  const lines = AGENT_ORDER.map((id) => {
    const en = h.config.agentsEnabled?.[id] !== false;
    const path = paths[id];
    const preview = loadAgentPersonality(id).split("\n")[0] || "";
    return `${AGENT_META[id].short} ${en ? "ON " : "OFF"}  ${path}\n    ${preview}`;
  });
  return lines.join("\n");
}
