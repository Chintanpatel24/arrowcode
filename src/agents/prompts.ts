import { readdirSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { AgentId, GoalState, PlanDoc, SessionPhase } from "../config/types";
import { AGENT_META } from "../config/types";
import { loadAgentPersonality } from "./personalities";
import { goalContextBlock } from "../core/goal";
import { getTemplate } from "../templates/catalog";
import { perfCaches } from "../perf/cache";
import { fastHash } from "../perf/fast-context";

function snapshot(workspace: string): string {
  try {
    const entries = readdirSync(workspace, { withFileTypes: true })
      .sort(
        (a, b) =>
          Number(b.isDirectory()) - Number(a.isDirectory()) ||
          a.name.localeCompare(b.name),
      )
      .slice(0, 40);
    return entries
      .map((e) => `  ${e.name}${e.isDirectory() ? "/" : ""}`)
      .join("\n");
  } catch {
    return "  (could not list)";
  }
}

function hints(workspace: string): string {
  const markers: [string, string][] = [
    ["package.json", "Node/JS"],
    ["tsconfig.json", "TypeScript"],
    ["pyproject.toml", "Python"],
    ["requirements.txt", "Python"],
    ["Cargo.toml", "Rust"],
    ["go.mod", "Go"],
    ["CMakeLists.txt", "C/C++"],
    ["Dockerfile", "Docker"],
    ["README.md", "README present"],
    ["ARROW.md", "ARROW.md project brain"],
  ];
  return (
    markers
      .filter(([f]) => existsSync(join(workspace, f)))
      .map(([, l]) => l)
      .join(", ") || "unknown"
  );
}

/** Optional project instruction file in the workspace (like a project brain). */
function loadProjectBrain(workspace: string): string {
  const key = `brain:${workspace}`;
  const cached = perfCaches.projectBrain.get(key);
  if (cached !== undefined) return cached;
  let out = "";
  for (const name of ["ARROW.md", "arrow.md", ".arrow/ARROW.md"]) {
    const p = join(workspace, name);
    if (!existsSync(p)) continue;
    try {
      const text = readFileSync(p, "utf8").slice(0, 12_000);
      out = `\n# Project brain (${name})\n${text}\n`;
      break;
    } catch {
      /* */
    }
  }
  perfCaches.projectBrain.set(key, out);
  return out;
}

export interface PromptContext {
  workspace: string;
  model: string;
  provider: string;
  phase: SessionPhase;
  goal: GoalState | null;
  plan: PlanDoc | null;
  systemExtra?: string;
  agentId?: string;
  isWorker?: boolean;
  depth?: number;
  /** Durable session memory block from SessionManager */
  sessionMemory?: string;
}

const SHARED = (ctx: PromptContext) => `
# Environment
- Workspace root: ${ctx.workspace}
- Model: ${ctx.model} via ${ctx.provider}
- Session phase: ${ctx.phase}
- Agent id: ${ctx.agentId || "unknown"}${ctx.isWorker ? ` (swarm worker depth ${ctx.depth ?? 1})` : " (main)"}
- Date: ${new Date().toISOString().slice(0, 16).replace("T", " ")}

# Workspace snapshot
${snapshot(ctx.workspace)}
Project hints: ${hints(ctx.workspace)}
${loadProjectBrain(ctx.workspace)}
${goalContextBlock(ctx.goal)}

${
  ctx.goal?.templateId
    ? `# Active template (${ctx.goal.templateId})\n${getTemplate(ctx.goal.templateId)?.body || ""}`
    : ""
}

${
  ctx.plan
    ? `# Confirmed / current plan\nTitle: ${ctx.plan.title}\n${ctx.plan.summary}\nSteps:\n${ctx.plan.steps.map((s, i) => `${i + 1}. ${s}`).join("\n")}\nAcceptance:\n${ctx.plan.acceptance.map((a) => `- ${a}`).join("\n")}`
    : ""
}

${ctx.sessionMemory ? `# Durable session memory\n${ctx.sessionMemory}\n` : ""}

# Security (non-negotiable)
- Never exfiltrate secrets, API keys, or private keys.
- Never write secrets into the repo; policy may block .env and key-like content.
- Prefer allowlisted commands; avoid destructive shell.
- Workspace sandbox: refuse path escape.

# Harness principles (Arena-class coding agent)
1. Be autonomous after plan confirm: act with tools; only ask when truly blocked.
2. Investigate before editing: list/glob/grep/read — never invent file layouts.
3. Stay inside the workspace. Paths relative to workspace root.
4. Prefer edit_file / multi_edit for surgical changes; write_file for new files.
5. Verify with bash / diagnostics after changes. Fix failures you introduce.
6. Match existing project style. Minimal correct diffs. No drive-by refactors.
7. No secrets in commits. No force-push. No destructive disk commands.
8. Use message_agent for handoffs and API contracts across FE/BE/QA.
9. Use spawn_worker for independent parallel subtasks. Check swarm_status.
10. Use todo_write for multi-step work. Use think for private reasoning.
11. Be honest. Do not fake success. Cite tool evidence.
12. Honor ARROW.md / project brain when present.
${ctx.systemExtra ? `\n# User extra instructions\n${ctx.systemExtra}\n` : ""}
`;

const PHASE_ORCH: Record<SessionPhase, string> = {
  idle: "Wait for a user goal or /plan command.",
  planning:
    "Explore the repo just enough, then either ask clarifying questions OR produce a structured plan if enough is known.",
  questions:
    "You are collecting answers. Incorporate user answers. Ask remaining high-value questions (total 3–7 across the whole Q&A), or produce the plan when ready.",
  await_confirm:
    "A plan is ready. Wait for the user to /confirm. You may refine the plan if they give feedback without confirming.",
  executing:
    "Plan is confirmed. Drive FE/BE/QA via message_agent. Encourage them to spawn_worker for parallel subtasks. Loop until ready for /accept.",
  await_accept:
    "Implementation appears ready. Summarize what shipped and wait for user /accept (or /reject to continue).",
  accepted: "Goal accepted. Idle unless new work arrives.",
  stopped: "Stopped by user. Idle.",
};

export function buildAgentSystemPrompt(id: AgentId, ctx: PromptContext): string {
  const cacheKey = `sys:${id}:${ctx.phase}:${ctx.model}:${fastHash((ctx.sessionMemory || "") + (ctx.goal?.text || "") + (ctx.plan?.title || "") + String(ctx.isWorker))}`;
  const cached = perfCaches.systemPrompt.get(cacheKey);
  if (cached) return cached;
  const meta = AGENT_META[id];
  const personality = loadAgentPersonality(id);

  let prompt: string;
  if (ctx.isWorker) {
    prompt = [
      `You are an ArrowCode SWARM WORKER under the ${meta.title} domain.`,
      `Worker id: ${ctx.agentId}  depth: ${ctx.depth ?? 1}`,
      "Focus only on the assigned subtask. You may spawn helpers if depth allows.",
      "When finished, write a clear summary of changes and verification.",
      "",
      "# Parent domain personality",
      personality,
      SHARED(ctx),
      `# Tools
read_file, write_file, edit_file, multi_edit, delete_file, move_file, list_dir, tree, glob, search_files, grep, find_symbol, bash, git_status, diff_workspace, diagnostics, think, todo_write, message_agent, spawn_worker, swarm_status, web_fetch, notebook_read, memory_append, memory_read
`,
    ].join("\n");
  } else {
    const phaseHint =
      id === "orchestrator"
        ? `\n# Current phase directive\n${PHASE_ORCH[ctx.phase]}\n`
        : ctx.phase === "executing" || ctx.phase === "await_accept"
          ? `\n# Current phase\nExecute mode is active. Follow orchestrator tasks. Spawn workers for parallel subtasks. Work toward the active goal.\n`
          : `\n# Current phase\n${ctx.phase}. Prefer standby / light exploration unless tasked.\n`;

    prompt = [
      `You are ArrowCode agent: ${meta.title}.`,
      meta.role,
      "",
      "# Personality (user-editable markdown in ~/.arrowcode/agents/)",
      personality,
      SHARED(ctx),
      phaseHint,
      `
# Swarm
- You can spawn_worker for independent parallel subtasks.
- Max depth 2 from main agents. Workers report via bus (kind=report).
- Prefer 2–4 focused workers over one giant serial loop when tasks are independent.
`,
      id === "orchestrator"
        ? `
# Orchestrator protocol
When you need clarifying questions, respond with a fenced block:
\`\`\`arrow-questions
1. question text
2. question text
\`\`\`
When the plan is ready, respond with:
\`\`\`arrow-plan
# Title
## Summary
...
## Steps
1. ...
## Risks
- ...
## Acceptance
- ...
## Assignments
- frontend: ...
- backend: ...
- tester: ...
\`\`\`
Do not implement code until phase is executing (plan confirmed).
When you believe the goal is ready for the user, emit:
\`\`\`arrow-ready
summary of what was done and how to verify
\`\`\`
`
        : "",
      `# Tools
read_file, write_file, edit_file, multi_edit, delete_file, move_file, list_dir, tree, glob, search_files, grep, find_symbol, bash, git_status, diff_workspace, diagnostics, think, todo_write, message_agent, spawn_worker, swarm_status, web_fetch, notebook_read, memory_append, memory_read
`,
    ].join("\n");
  }
  perfCaches.systemPrompt.set(cacheKey, prompt);
  return prompt;
}

export function extractPlan(text: string): PlanDoc | null {
  const m = text.match(/```arrow-plan\s*([\s\S]*?)```/i);
  const raw = m ? m[1]!.trim() : "";
  if (!raw && !/##\s*Steps/i.test(text)) return null;
  const body = raw || text;
  const title =
    body.match(/^#\s+(.+)$/m)?.[1]?.trim() ||
    body.match(/Title:\s*(.+)/i)?.[1]?.trim() ||
    "Plan";
  const summary =
    section(body, "Summary") ||
    body.split("\n").slice(0, 5).join(" ").slice(0, 400);
  const steps = bullets(section(body, "Steps") || "");
  const risks = bullets(section(body, "Risks") || "");
  const acceptance = bullets(section(body, "Acceptance") || "");
  const assignRaw = section(body, "Assignments") || "";
  const agents: PlanDoc["agents"] = {};
  for (const line of assignRaw.split("\n")) {
    const mm = line.match(/(frontend|backend|tester|orchestrator)\s*:\s*(.+)/i);
    if (mm) {
      const k = mm[1]!.toLowerCase() as AgentId;
      agents[k] = mm[2]!.trim();
    }
  }
  return {
    title,
    summary,
    steps: steps.length ? steps : ["Execute the goal"],
    risks,
    acceptance: acceptance.length ? acceptance : ["User accepts via /accept"],
    agents,
    raw: body,
    createdAt: Date.now(),
  };
}

export function extractQuestions(text: string): string[] {
  const m = text.match(/```arrow-questions\s*([\s\S]*?)```/i);
  const block = m ? m[1]! : text;
  const qs: string[] = [];
  for (const line of block.split("\n")) {
    const mm = line.match(/^\s*(?:\d+[\).\]]|-)\s+(.+)/);
    if (mm) qs.push(mm[1]!.trim());
  }
  if (!qs.length) {
    for (const line of text.split("\n")) {
      const t = line.trim();
      if (t.endsWith("?") && t.length > 8 && t.length < 240) qs.push(t);
    }
  }
  return qs.slice(0, 7);
}

export function extractReady(text: string): string | null {
  const m = text.match(/```arrow-ready\s*([\s\S]*?)```/i);
  return m ? m[1]!.trim() : null;
}

function section(body: string, name: string): string {
  const re = new RegExp(
    `##\\s*${name}\\s*\\n([\\s\\S]*?)(?=\\n##\\s|$)`,
    "i",
  );
  return body.match(re)?.[1]?.trim() || "";
}

function bullets(s: string): string[] {
  return s
    .split("\n")
    .map((l) => l.replace(/^\s*(?:\d+[\).\]]|-|\*)\s+/, "").trim())
    .filter(Boolean);
}
