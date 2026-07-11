/**
 * Offline smoke tests (no real LLM calls).
 */
import { existsSync } from "node:fs";
import { seedAgentPersonalities, listAgentPersonalityPaths, packagedAgentPaths } from "../src/agents/personalities";
import { listTemplates } from "../src/templates/catalog";
import { createGoalFromText } from "../src/core/goal";
import { extractPlan, extractQuestions } from "../src/agents/prompts";
import { Harness } from "../src/core/harness";
import { manageContext, estimateChars } from "../src/memory/context";
import { buildTools } from "../src/tools/builtin";
import { Workspace } from "../src/tools/workspace";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaultsAgentsDir, defaultsTemplatesDir } from "../src/config/paths";
import { bootstrapUserHome } from "../src/bootstrap/install-home";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

// Packaged defaults must exist IN REPO without ~/.arrowcode
assert(existsSync(defaultsAgentsDir()), "defaults/agents missing from repo");
assert(existsSync(defaultsTemplatesDir()), "defaults/templates missing from repo");
const packaged = packagedAgentPaths();
assert(existsSync(packaged.orchestrator), "packaged orchestrator.md");

// list templates without requiring home first
const tmplsBefore = listTemplates();
assert(tmplsBefore.length >= 12, "templates from defaults/");

// bootstrap creates home
const boot = bootstrapUserHome();
assert(existsSync(boot.home), "home created");
seedAgentPersonalities();
const paths = listAgentPersonalityPaths();
assert(paths.orchestrator.includes(".arrowcode"), "personality path in user home");

const tmpls = listTemplates();
assert(tmpls.length >= 12, "templates");

const plan = extractPlan(`\`\`\`arrow-plan
# T
## Summary
s
## Steps
1. a
## Acceptance
- ok
## Assignments
- frontend: ui
\`\`\``);
assert(plan?.title === "T", "plan parse");

const qs = extractQuestions(`\`\`\`arrow-questions
1. One?
2. Two?
\`\`\``);
assert(qs.length === 2, "questions");

const dir = mkdtempSync(join(tmpdir(), "arrow-smoke-"));
const ws = new Workspace(dir);
const tools = buildTools({ workspace: ws, todos: [] });
const map = Object.fromEntries(tools.map((t) => [t.name, t]));
assert(map.spawn_worker, "spawn tool");
assert(map.swarm_status, "swarm status tool");
assert(map.multi_edit, "multi_edit");
assert(map.tree, "tree");
assert(map.find_symbol, "find_symbol");
assert(map.diagnostics, "diagnostics");

let r = await map.write_file!.execute({ path: "a.ts", content: "export const n = 1;\n" });
assert(r.success, "write");
r = await map.read_file!.execute({ path: "a.ts" });
assert(String(r.output).includes("export const n"), "read");
r = await map.edit_file!.execute({
  path: "a.ts",
  old_text: "n = 1",
  new_text: "n = 2",
});
assert(r.success, "edit");
r = await map.bash!.execute({ command: "echo ok" });
assert(r.success && String(r.output).includes("ok"), "bash");
r = await map.read_file!.execute({ path: "/etc/passwd" });
assert(!r.success, "sandbox");

const h = new Harness({
  provider: "nim",
  model: "meta/llama-3.3-70b-instruct",
  apiKey: "nvapi-test",
  baseUrl: "https://integrate.api.nvidia.com/v1",
  temperature: 0.2,
  maxTokens: 1024,
  maxToolRounds: 5,
  maxExecuteCycles: 3,
  autoApprove: true,
  workspace: dir,
  swarm: {
    maxWorkers: 16,
    maxDepth: 2,
    maxChildrenPerAgent: 4,
    summarizeThresholdChars: 100_000,
    keepRecentMessages: 14,
    enabled: true,
  },
  contextBudgetChars: 120_000,
});

assert(h.swarm, "swarm engine");
const spawn = h.swarm.spawn({
  parentId: "frontend",
  role: "form",
  task: "noop test worker — just finish",
});
// spawn creates worker that will try LLM — may error quickly without real API; still registers
assert(spawn.ok, "spawn ok: " + JSON.stringify(spawn));
if (spawn.ok) {
  // stop immediately to avoid hanging network
  h.swarm.get(spawn.id)?.stop();
}

createGoalFromText("Smoke goal", "feature");
h.accept("smoke");
assert(h.phase === "accepted", "accept");

// context trim
const msgs = [
  { role: "system" as const, content: "sys" },
  ...Array.from({ length: 40 }, (_, i) => ({
    role: "user" as const,
    content: "x".repeat(500) + i,
  })),
];
const trimmed = await manageContext(msgs as never, {
  complete: async () => "summary bullets",
  chat: async () => ({ content: "summary", toolCalls: [], usage: { prompt_tokens: 0, completion_tokens: 0 } }),
} as never, {
  budgetChars: 5000,
  summarizeThreshold: 2000,
  keepRecent: 6,
});
assert(estimateChars(trimmed.messages) <= 8000, "context managed");

console.log("SMOKE OK");
console.log("  templates:", tmpls.length);
console.log("  tools:", tools.map((t) => t.name).join(", "));
console.log("  workspace:", dir);

// cleanup: do not leave ~/.arrowcode on the system after tests
try {
  const { rmSync } = await import("node:fs");
  const { ARROW_HOME } = await import("../src/config/paths.ts");
  rmSync(ARROW_HOME, { recursive: true, force: true });
  console.log("cleaned", ARROW_HOME);
} catch (e) {
  console.log("cleanup skip", e);
}
