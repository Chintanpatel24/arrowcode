/** Shared types for ArrowCode — swarm multi-agent coding harness. */

export type ProviderId = "nim" | "openai" | "anthropic" | "ollama" | "groq" | "deepseek" | "gemini" | "openrouter" | "custom" | "demo" | "mock";

export type AgentId = "orchestrator" | "frontend" | "backend" | "tester";

/** Main squad + dynamic swarm workers (e.g. frontend.w1, backend.w2.h1) */
export type AgentRef = AgentId | string;

export type AgentStatus =
  | "idle"
  | "thinking"
  | "tool"
  | "waiting"
  | "done"
  | "error"
  | "blocked"
  | "spawning";

export type SessionPhase =
  | "idle"
  | "planning"
  | "questions"
  | "await_confirm"
  | "executing"
  | "await_accept"
  | "accepted"
  | "stopped";

/** Per-endpoint LLM credentials (global or per-agent). */
export interface EndpointConfig {
  provider: ProviderId;
  model: string;
  apiKey: string;
  baseUrl: string;
  temperature?: number;
  maxTokens?: number;
}

/** Per-agent override of endpoint + enable flag. */
export interface AgentEndpointConfig extends Partial<EndpointConfig> {
  enabled?: boolean;
  /** Soft context char budget for this agent */
  contextBudget?: number;
}

export interface SwarmConfig {
  /** Max concurrent workers across the whole swarm (default 16) */
  maxWorkers: number;
  /** Max spawn depth: 0=main only, 1=main->worker, 2=main->worker->helper */
  maxDepth: number;
  /** Max children one agent may spawn at once */
  maxChildrenPerAgent: number;
  /** Auto-summarize when messages exceed this many chars */
  summarizeThresholdChars: number;
  /** Keep last N messages after trim (plus system) */
  keepRecentMessages: number;
  enabled: boolean;
}

export interface ArrowConfig {
  provider: ProviderId;
  model: string;
  apiKey: string;
  baseUrl: string;
  temperature: number;
  maxTokens: number;
  maxToolRounds: number;
  maxExecuteCycles: number;
  autoApprove: boolean;
  workspace: string;
  agentModels?: Partial<Record<AgentId, string>>;
  agentsEnabled?: Partial<Record<AgentId, boolean>>;
  /** Full per-agent endpoint overrides */
  agentEndpoints?: Partial<Record<AgentId, AgentEndpointConfig>>;
  templateId?: string;
  goal?: string;
  systemExtra?: string;
  swarm: SwarmConfig;
  /** Global context budget (chars) for main agents */
  contextBudgetChars: number;
}

export interface AgentLogLine {
  ts: number;
  kind:
    | "info"
    | "think"
    | "tool"
    | "result"
    | "error"
    | "say"
    | "plan"
    | "ask"
    | "swarm"
    | "memory";
  text: string;
}

export interface TodoItem {
  id: string;
  content: string;
  status: "pending" | "in_progress" | "completed" | "cancelled";
  owner?: AgentRef;
}

export interface TaskEnvelope {
  id: string;
  from: AgentRef | "user";
  to: AgentRef | "all";
  kind: "task" | "result" | "note" | "block" | "done" | "spawn" | "report";
  title: string;
  body: string;
  ts: number;
  meta?: Record<string, unknown>;
}

export interface PlanQuestion {
  id: string;
  question: string;
  answer?: string;
}

export interface PlanDoc {
  title: string;
  summary: string;
  steps: string[];
  risks: string[];
  acceptance: string[];
  agents: Partial<Record<AgentId, string>>;
  raw: string;
  createdAt: number;
  confirmedAt?: number;
}

export interface GoalState {
  text: string;
  templateId?: string;
  checklist: { id: string; text: string; done: boolean }[];
  createdAt: number;
  updatedAt: number;
}

export interface WorkerSpec {
  id: string;
  parentId: AgentRef;
  role: string;
  task: string;
  depth: number;
  endpoint?: Partial<EndpointConfig>;
  status: AgentStatus;
  createdAt: number;
  finishedAt?: number;
  result?: string;
}

export const AGENT_ORDER: AgentId[] = [
  "orchestrator",
  "frontend",
  "backend",
  "tester",
];

export const AGENT_META: Record<
  AgentId,
  { title: string; short: string; role: string; file: string }
> = {
  orchestrator: {
    title: "ORCHESTRATOR",
    short: "ORCH",
    role: "Plans, asks, confirms, drives the swarm, tracks the goal until accept.",
    file: "orchestrator.md",
  },
  frontend: {
    title: "FRONTEND",
    short: "FE",
    role: "Owns UI, components, client state, styling — spawns UI workers as needed.",
    file: "frontend.md",
  },
  backend: {
    title: "BACKEND",
    short: "BE",
    role: "Owns APIs, servers, data, auth — spawns API/data workers as needed.",
    file: "backend.md",
  },
  tester: {
    title: "TESTER",
    short: "QA",
    role: "Tests and verifies FE+BE — spawns check workers as needed.",
    file: "tester.md",
  },
};

export const DEFAULT_NIM_BASE = "https://integrate.api.nvidia.com/v1";
export const DEFAULT_NIM_MODEL = "meta/llama-3.3-70b-instruct";
export const DEFAULT_OPENAI_BASE = "https://api.openai.com/v1";
export const DEFAULT_OLLAMA_BASE = "http://localhost:11434/v1";

export const DEFAULT_SWARM: SwarmConfig = {
  maxWorkers: 16,
  maxDepth: 2,
  maxChildrenPerAgent: 4,
  summarizeThresholdChars: 100_000,
  keepRecentMessages: 14,
  enabled: true,
};

export const NIM_MODELS = [
  "meta/llama-3.3-70b-instruct",
  "meta/llama-3.1-70b-instruct",
  "nvidia/llama-3.3-nemotron-super-49b-v1",
  "qwen/qwen2.5-coder-32b-instruct",
  "deepseek-ai/deepseek-v3.1",
  "mistralai/mistral-large-2-instruct",
  "mistralai/codestral-22b-instruct-v0.1",
] as const;

export const TEMPLATE_IDS = [
  "feature",
  "bugfix",
  "refactor",
  "tests",
  "fullstack",
  "api",
  "ui",
  "review",
  "migrate",
  "spike",
  "perf",
  "security",
] as const;

export type TemplateId = (typeof TEMPLATE_IDS)[number] | string;

export function isMainAgent(id: string): id is AgentId {
  return (AGENT_ORDER as string[]).includes(id);
}

export function parentOfWorker(id: string): string | null {
  const i = id.lastIndexOf(".");
  if (i <= 0) return null;
  return id.slice(0, i);
}

export function rootAgentOf(id: string): AgentId {
  const root = id.split(".")[0] || "orchestrator";
  if (isMainAgent(root)) return root;
  return "orchestrator";
}
