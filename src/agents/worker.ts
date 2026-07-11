import type OpenAI from "openai";
import type {
  AgentId,
  AgentLogLine,
  AgentRef,
  AgentStatus,
  ArrowConfig,
  EndpointConfig,
  GoalState,
  PlanDoc,
  SessionPhase,
  TodoItem,
  TaskEnvelope,
} from "../config/types";
import { AGENT_META, isMainAgent, rootAgentOf } from "../config/types";
import { resolveEndpoint } from "../config/load";
import { LLMClient, LLMError, type ToolCall } from "../llm/client";
import { buildTools, type ToolContext } from "../tools/builtin";
import { toOpenAITools, truncateResult, type ToolDefinition } from "../tools/types";
import { Workspace } from "../tools/workspace";
import {
  buildAgentSystemPrompt,
  extractPlan,
  extractQuestions,
  extractReady,
  type PromptContext,
} from "./prompts";
import type { MessageBus } from "../core/bus";
import type { EventBus } from "../core/events";
import { manageContextFast } from "../perf/fast-context";
import { runToolsParallel, isParallelSafeTool } from "../perf/parallel";
import { perf } from "../perf/timers";
import { invalidateFileCaches } from "../perf/cache";
import type { SwarmEngine } from "../swarm/engine";

export interface WorkerHooks {
  onPlan?: (plan: ReturnType<typeof extractPlan>) => void;
  onQuestions?: (qs: string[]) => void;
  onReady?: (summary: string) => void;
  onFinished?: (result: string) => void;
}

export interface AgentWorkerOptions {
  id: AgentRef;
  /** Main agent role for personality / root endpoint */
  rootId: AgentId;
  roleLabel?: string;
  depth?: number;
  isWorker?: boolean;
  endpoint?: EndpointConfig;
  config: ArrowConfig;
  workspace: Workspace;
  bus: MessageBus;
  events: EventBus;
  swarm?: SwarmEngine;
  hooks?: WorkerHooks;
  trackFile?: (kind: "read" | "write" | "edit" | "delete" | "move", path: string, contentAfter?: string) => void;
}

export class AgentWorker {
  readonly id: AgentRef;
  readonly rootId: AgentId;
  readonly title: string;
  readonly depth: number;
  readonly isWorker: boolean;

  private config: ArrowConfig;
  private llm: LLMClient;
  private messages: OpenAI.Chat.ChatCompletionMessageParam[] = [];
  private tools: ToolDefinition[];
  private toolMap: Map<string, ToolDefinition>;
  private todos: TodoItem[] = [];
  private bus: MessageBus;
  private events: EventBus;
  private workspace: Workspace;
  private swarm?: SwarmEngine;
  private running = false;
  private stopped = false;
  private queue: string[] = [];
  private status: AgentStatus = "idle";
  private approvalHandler?: (
    tool: string,
    args: Record<string, unknown>,
  ) => Promise<boolean>;
  private phase: SessionPhase = "idle";
  private goal: GoalState | null = null;
  private plan: PlanDoc | null = null;
  private sessionMemory: string = "";
  private hooks: WorkerHooks = {};
  private enabled = true;
  private trackFile?: AgentWorkerOptions["trackFile"];
  private unsubBus?: () => void;
  private lastAssistantText = "";

  tokenIn = 0;
  tokenOut = 0;
  toolCalls = 0;

  constructor(opts: AgentWorkerOptions) {
    this.id = opts.id;
    this.rootId = opts.rootId;
    this.depth = opts.depth ?? 0;
    this.isWorker = Boolean(opts.isWorker);
    this.title = opts.roleLabel
      || (isMainAgent(String(opts.id))
        ? AGENT_META[opts.id as AgentId].title
        : opts.id);
    this.config = opts.config;
    this.workspace = opts.workspace;
    this.bus = opts.bus;
    this.events = opts.events;
    this.swarm = opts.swarm;
    this.hooks = opts.hooks || {};
    this.trackFile = opts.trackFile;

    if (isMainAgent(String(opts.id))) {
      this.enabled = opts.config.agentsEnabled?.[opts.id as AgentId] !== false;
    }

    const endpoint =
      opts.endpoint || resolveEndpoint(opts.config, opts.rootId);
    this.llm = new LLMClient(endpoint);

    this.tools = this.buildToolset();
    this.toolMap = new Map(this.tools.map((t) => [t.name, t]));
    this.rebuildSystem();

    this.unsubBus = this.bus.on(this.id, (msg) => {
      if (msg.from === this.id) return;
      if (!this.enabled) return;
      const text =
        `[agent-message from=${msg.from} kind=${msg.kind}]\n` +
        `title: ${msg.title}\n` +
        `${msg.body}`;
      this.enqueue(text, msg.kind === "task" || msg.kind === "report");
    });
  }

  private buildToolset(): ToolDefinition[] {
    const ctx: ToolContext = {
      workspace: this.workspace,
      todos: this.todos,
      agentId: String(this.id),
      bus: {
        send: ({ to, kind, title, body }) => {
          this.bus.publish({
            from: this.id,
            to: to as AgentRef | "all",
            kind: kind as TaskEnvelope["kind"],
            title,
            body,
          });
        },
      },
      spawnWorker: this.swarm
        ? ({ role, task }) =>
            this.swarm!.spawn({
              parentId: this.id,
              role,
              task,
            })
        : undefined,
      trackFile: this.trackFile
        ? (kind, path, contentAfter) =>
            this.trackFile!(kind, path, contentAfter)
        : undefined,
      swarmStatus: this.swarm
        ? () => {
            const s = this.swarm!.stats();
            const list = this.swarm!.listWorkers()
              .map(
                (w) =>
                  `- ${w.id} d${w.depth} [${w.status}] ${w.role}: ${w.task.slice(0, 60)}`,
              )
              .join("\n");
            return [
              `swarm enabled=${this.config.swarm.enabled}`,
              `active=${s.active} workers=${s.workers} maxWorkers=${s.maxWorkers} maxDepth=${s.maxDepth}`,
              list || "(no workers)",
            ].join("\n");
          }
        : undefined,
    };
    return buildTools(ctx);
  }

  setHooks(h: WorkerHooks) {
    this.hooks = { ...this.hooks, ...h };
  }

  setApprovalHandler(
    fn: (tool: string, args: Record<string, unknown>) => Promise<boolean>,
  ) {
    this.approvalHandler = fn;
  }

  setSwarm(swarm: SwarmEngine) {
    this.swarm = swarm;
    this.tools = this.buildToolset();
    this.toolMap = new Map(this.tools.map((t) => [t.name, t]));
  }

  setEnabled(v: boolean) {
    this.enabled = v;
  }

  updateContext(opts: {
    phase?: SessionPhase;
    goal?: GoalState | null;
    plan?: PlanDoc | null;
    config?: ArrowConfig;
    sessionMemory?: string;
  }) {
    if (opts.phase) this.phase = opts.phase;
    if (opts.goal !== undefined) this.goal = opts.goal;
    if (opts.plan !== undefined) this.plan = opts.plan;
    if (opts.sessionMemory !== undefined) this.sessionMemory = opts.sessionMemory;
    if (opts.config) {
      this.config = opts.config;
      if (isMainAgent(String(this.id))) {
        this.enabled = opts.config.agentsEnabled?.[this.id as AgentId] !== false;
      }
      const endpoint = resolveEndpoint(opts.config, this.rootId);
      this.llm = new LLMClient(endpoint);
      this.tools = this.buildToolset();
      this.toolMap = new Map(this.tools.map((t) => [t.name, t]));
    }
    this.rebuildSystem();
  }

  private promptCtx(): PromptContext {
    return {
      workspace: this.workspace.root,
      model: this.llm.model,
      provider: this.llm.provider,
      phase: this.phase,
      goal: this.goal,
      plan: this.plan,
      systemExtra: this.config.systemExtra,
      agentId: String(this.id),
      isWorker: this.isWorker,
      depth: this.depth,
      sessionMemory: this.sessionMemory,
    };
  }

  private rebuildSystem() {
    const system = buildAgentSystemPrompt(this.rootId, this.promptCtx());
    if (this.messages[0]?.role === "system") {
      this.messages[0] = { role: "system", content: system };
    } else {
      this.messages.unshift({ role: "system", content: system });
    }
  }

  getStatus(): AgentStatus {
    return this.status;
  }

  isBusy(): boolean {
    return (
      this.running ||
      this.queue.length > 0 ||
      this.status === "thinking" ||
      this.status === "tool" ||
      this.status === "waiting" ||
      this.status === "spawning"
    );
  }

  private setStatus(status: AgentStatus, detail?: string) {
    this.status = status;
    this.events.emit({
      type: "agent_status",
      agent: this.id,
      status,
      detail,
    });
  }

  private log(kind: AgentLogLine["kind"], text: string) {
    const line: AgentLogLine = { ts: Date.now(), kind, text };
    this.events.emit({ type: "agent_log", agent: this.id, line });
  }

  enqueue(content: string, _priority = false) {
    if (this.stopped) return;
    if (!this.enabled && isMainAgent(String(this.id))) return;
    this.queue.push(content);
    void this.pump();
  }

  assign(userText: string) {
    this.enqueue(userText, true);
  }

  stop() {
    this.stopped = true;
    this.queue = [];
    this.setStatus("idle");
  }

  private async pump() {
    if (this.running || this.stopped) return;
    this.running = true;
    try {
      while (this.queue.length && !this.stopped) {
        const next = this.queue.shift()!;
        await this.runTurn(next);
      }
    } finally {
      this.running = false;
      if (this.queue.length && !this.stopped) void this.pump();
    }
  }

  private async runTurn(userText: string) {
    this.rebuildSystem();
    this.messages.push({ role: "user", content: userText });
    await this.applyContextManagement();
    this.setStatus("thinking");
    this.log("info", userText.slice(0, 220));

    const lightPhase =
      !this.isWorker &&
      this.rootId === "orchestrator" &&
      (this.phase === "questions" || this.phase === "await_confirm");
    const openaiTools = lightPhase ? undefined : toOpenAITools(this.tools);
    const maxRounds = this.isWorker
      ? Math.min(this.config.maxToolRounds, 16)
      : this.config.maxToolRounds;

    for (let round = 0; round < maxRounds; round++) {
      if (this.stopped) return;
      let streamed = "";
      try {
        this.setStatus("thinking");
        const resp = await this.llm.chat(this.messages, openaiTools, {
          stream: !this.isWorker,
          onToken: this.isWorker
            ? undefined
            : (t) => {
                streamed += t;
                this.events.emit({
                  type: "agent_log",
                  agent: this.id,
                  line: { ts: Date.now(), kind: "say", text: t },
                });
              },
        });
        this.tokenIn += resp.usage.prompt_tokens;
        this.tokenOut += resp.usage.completion_tokens;
        this.events.emit({
          type: "agent_tokens",
          agent: this.id,
          tokenIn: this.tokenIn,
          tokenOut: this.tokenOut,
          toolCalls: this.toolCalls,
        });

        const content = resp.content ?? (streamed || null);
        this.lastAssistantText = content || this.lastAssistantText;
        const asst: OpenAI.Chat.ChatCompletionMessageParam = {
          role: "assistant",
          content,
          ...(resp.toolCalls.length
            ? {
                tool_calls: resp.toolCalls.map((tc) => ({
                  id: tc.id,
                  type: "function" as const,
                  function: { name: tc.name, arguments: tc.arguments },
                })),
              }
            : {}),
        };
        this.messages.push(asst);

        if (content && !this.isWorker && this.rootId === "orchestrator") {
          this.detectStructured(content);
        }

        if (!resp.toolCalls.length) {
          this.setStatus("done");
          if (content) this.log("say", content.slice(0, 500));
          if (
            !this.isWorker &&
            this.rootId === "orchestrator" &&
            content &&
            /ship|complete|done|summary/i.test(content)
          ) {
            this.events.emit({ type: "final", text: content });
          }
          if (this.isWorker) {
            this.hooks.onFinished?.(content || this.lastAssistantText || "(done)");
          }
          return;
        }

        // Lightning: parallelize contiguous read-only tools
        if (resp.toolCalls.length > 1) {
          perf.inc("agent.multi_tool_turns");
          await runToolsParallel(
            resp.toolCalls,
            async (tc) => {
              await this.execTool(tc);
              return null;
            },
            this.isWorker ? 4 : 8,
          );
        } else {
          for (const tc of resp.toolCalls) {
            await this.execTool(tc);
          }
        }
        await this.applyContextManagement();
      } catch (e) {
        const msg = e instanceof LLMError ? e.message : String(e);
        this.setStatus("error", msg);
        this.log("error", msg);
        if (this.isWorker) this.hooks.onFinished?.(`ERROR: ${msg}`);
        return;
      }
    }
    this.setStatus("done");
    this.log("info", `Stopped after ${maxRounds} tool rounds`);
    if (this.isWorker) {
      this.hooks.onFinished?.(this.lastAssistantText || "(max rounds)");
    }
  }

  private async applyContextManagement() {
    const budget =
      this.config.agentEndpoints?.[this.rootId]?.contextBudget ||
      (this.isWorker
        ? Math.min(this.config.contextBudgetChars, 60_000)
        : this.config.contextBudgetChars);
    // Lightning path: pure trim unless far over threshold
    const threshold = this.config.swarm.summarizeThresholdChars;
    const sizeHint = JSON.stringify(this.messages).length;
    const pureTrimOnly = sizeHint < threshold * 1.5;
    const res = await manageContextFast(this.messages, this.llm, {
      budgetChars: budget,
      summarizeThreshold: threshold,
      keepRecent: this.config.swarm.keepRecentMessages,
      pureTrimOnly,
    });
    this.messages = res.messages;
    if (res.didSummarize) this.log("memory", "context summarized");
    else if (res.didTrim) this.log("memory", "context trimmed");
  }

  private detectStructured(content: string) {
    const ready = extractReady(content);
    if (ready) this.hooks.onReady?.(ready);

    const plan = extractPlan(content);
    if (
      plan &&
      (this.phase === "planning" ||
        this.phase === "questions" ||
        this.phase === "await_confirm")
    ) {
      this.hooks.onPlan?.(plan);
      this.log("plan", plan.title);
    }

    if (this.phase === "planning" || this.phase === "questions") {
      const qs = extractQuestions(content);
      if (
        qs.length &&
        (/```arrow-questions/i.test(content) || (!plan && qs.length >= 2))
      ) {
        this.hooks.onQuestions?.(qs);
        for (const q of qs) this.log("ask", q);
      }
    }
  }

  private async execTool(tc: ToolCall) {
    let args: Record<string, unknown> = {};
    try {
      args = tc.arguments ? JSON.parse(tc.arguments) : {};
    } catch {
      args = { _raw: tc.arguments };
    }
    const preview = toolPreview(tc.name, args);
    if (tc.name === "spawn_worker") this.setStatus("spawning", preview);
    else this.setStatus("tool", `${tc.name} ${preview}`);

    this.events.emit({
      type: "agent_tool",
      agent: this.id,
      name: tc.name,
      detail: preview,
    });
    this.log(tc.name === "spawn_worker" ? "swarm" : "tool", `${tc.name} ${preview}`);

    const def = this.toolMap.get(tc.name);
    if (!def) {
      const err = `Unknown tool: ${tc.name}`;
      this.messages.push({
        role: "tool",
        tool_call_id: tc.id,
        content: `ERROR: ${err}`,
      });
      this.log("error", err);
      return;
    }

    if (def.requiresApproval && !this.config.autoApprove) {
      this.setStatus("waiting", `approve ${tc.name}`);
      const allowed = this.approvalHandler
        ? await this.approvalHandler(tc.name, args)
        : false;
      if (!allowed) {
        this.messages.push({
          role: "tool",
          tool_call_id: tc.id,
          content: "ERROR: User denied tool execution.",
        });
        this.log("error", `denied ${tc.name}`);
        this.setStatus("thinking");
        return;
      }
    }

    let result;
    try {
      result = truncateResult(await def.execute(args));
    } catch (e) {
      result = { success: false, output: "", error: String(e) };
    }
    this.toolCalls++;
    this.events.emit({
      type: "agent_tokens",
      agent: this.id,
      tokenIn: this.tokenIn,
      tokenOut: this.tokenOut,
      toolCalls: this.toolCalls,
    });
    if (tc.name === "todo_write") {
      this.events.emit({
        type: "agent_todos",
        agent: this.id,
        todos: [...this.todos],
      });
    }

    const text = result.success
      ? result.output || "(ok)"
      : `ERROR: ${result.error || "fail"}${result.output ? "\n" + result.output : ""}`;
    this.messages.push({
      role: "tool",
      tool_call_id: tc.id,
      content: text,
    });
    this.log("result", text.split("\n")[0]!.slice(0, 160));
    if (["write_file", "edit_file", "multi_edit", "delete_file", "move_file"].includes(tc.name)) {
      invalidateFileCaches();
    }
    perf.inc("tools.exec");
    perf.inc(`tools.${tc.name}`);
    this.setStatus("thinking");
  }

  reset() {
    this.messages = [];
    this.rebuildSystem();
    this.todos = [];
    this.tokenIn = 0;
    this.tokenOut = 0;
    this.toolCalls = 0;
    this.queue = [];
    this.stopped = false;
    this.setStatus("idle");
  }

  dispose() {
    this.stop();
    this.unsubBus?.();
  }
}

/** Factory for swarm engine workers */
export function createSwarmWorkerHandle(args: {
  id: string;
  parentId: AgentRef;
  role: string;
  task: string;
  depth: number;
  endpoint: EndpointConfig;
  config: ArrowConfig;
  workspace: Workspace;
  bus: MessageBus;
  events: EventBus;
  swarm: SwarmEngine;
  onFinished: (id: string, result: string) => void;
  trackFile?: (kind: "read" | "write" | "edit" | "delete" | "move", path: string, contentAfter?: string) => void;
}): import("../swarm/engine").SwarmWorkerHandle {
  const rootId = rootAgentOf(args.id);
  const worker = new AgentWorker({
    id: args.id,
    rootId,
    roleLabel: args.role,
    depth: args.depth,
    isWorker: true,
    endpoint: args.endpoint,
    config: args.config,
    workspace: args.workspace,
    bus: args.bus,
    events: args.events,
    swarm: args.swarm,
    trackFile: args.trackFile,
    hooks: {
      onFinished: (result) => args.onFinished(args.id, result),
    },
  });
  worker.setSwarm(args.swarm);

  const spec: import("../config/types").WorkerSpec = {
    id: args.id,
    parentId: args.parentId,
    role: args.role,
    task: args.task,
    depth: args.depth,
    endpoint: args.endpoint,
    status: "spawning",
    createdAt: Date.now(),
  };

  return {
    get spec() {
      spec.status = worker.getStatus();
      return spec;
    },
    set spec(s) {
      Object.assign(spec, s);
    },
    assign: (text: string) => worker.assign(text),
    isBusy: () => worker.isBusy(),
    getStatus: () => worker.getStatus(),
    stop: () => worker.dispose(),
    get tokenIn() {
      return worker.tokenIn;
    },
    get tokenOut() {
      return worker.tokenOut;
    },
    get toolCalls() {
      return worker.toolCalls;
    },
  };
}

function toolPreview(name: string, args: Record<string, unknown>): string {
  if (name === "bash") return `$ ${String(args.command || "").slice(0, 80)}`;
  if (["read_file", "write_file", "edit_file"].includes(name))
    return String(args.path || "");
  if (name === "grep") return `/${args.pattern}/`;
  if (name === "glob") return String(args.pattern || "");
  if (name === "message_agent") return `-> ${args.to}: ${args.title}`;
  if (name === "spawn_worker")
    return `${args.role}: ${String(args.task || "").slice(0, 50)}`;
  if (name === "list_dir") return String(args.path || ".");
  try {
    return JSON.stringify(args).slice(0, 80);
  } catch {
    return "";
  }
}
