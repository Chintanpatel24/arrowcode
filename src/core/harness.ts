import { resolve } from "node:path";
import { writeFileSync } from "node:fs";
import type {
  AgentId,
  ArrowConfig,
  GoalState,
  PlanDoc,
  PlanQuestion,
  SessionPhase,
} from "../config/types";
import { AGENT_ORDER } from "../config/types";
import { PLAN_PATH } from "../config/paths";
import { ensureArrowHome } from "../config/load";
import { Workspace } from "../tools/workspace";
import { MessageBus } from "./bus";
import { EventBus } from "./events";
import { AgentWorker, createSwarmWorkerHandle } from "../agents/worker";
import {
  createGoalFromText,
  loadGoal,
  saveGoal,
  goalContextBlock,
} from "./goal";
import { getTemplate, listTemplates, seedTemplates } from "../templates/catalog";
import { seedAgentPersonalities } from "../agents/personalities";
import { SwarmEngine, formatSwarmTree } from "../swarm/engine";
import type { AgentRef } from "../config/types";
import {
  createMetrics,
  formatMetrics,
  journal,
  writeSessionSnapshot,
  type SessionMetrics,
} from "./metrics";
import { SessionLog } from "./session-log";
import { FileTracker } from "./file-tracker";
import { CheckpointStore } from "./checkpoints";
import { DEFAULT_POLICY, evaluateToolPolicy, type PolicyConfig } from "./policy";
import { isUserHomePresent } from "../bootstrap/install-home";
import { join } from "node:path";
import { SessionManager } from "../session/manager";
import { perf } from "../perf/timers";

/**
 * ArrowCode harness — plan -> questions -> confirm -> execute until /accept.
 * Owns swarm, bus, phase machine, metrics, and session journal.
 */
export class Harness {
  config: ArrowConfig;
  readonly workspace: Workspace;
  readonly bus: MessageBus;
  readonly events: EventBus;
  readonly agents: Map<AgentId, AgentWorker>;
  readonly swarm: SwarmEngine;
  readonly metrics: SessionMetrics;
  readonly sessionLog: SessionLog;
  readonly files: FileTracker;
  readonly checkpoints: CheckpointStore;
  readonly sessions: SessionManager;
  policy: PolicyConfig = { ...DEFAULT_POLICY };

  phase: SessionPhase = "idle";
  goal: GoalState | null = null;
  plan: PlanDoc | null = null;
  questions: PlanQuestion[] = [];
  cycle = 0;

  private pendingApprovals = new Map<
    string,
    { resolve: (v: boolean) => void; agent: AgentRef; tool: string }
  >();
  private runActive = false;
  private stopFlag = false;

  constructor(config: ArrowConfig) {
    this.config = {
      ...config,
      workspace: resolve(config.workspace),
      swarm: config.swarm || {
        maxWorkers: 16,
        maxDepth: 2,
        maxChildrenPerAgent: 4,
        summarizeThresholdChars: 100_000,
        keepRecentMessages: 14,
        enabled: true,
      },
      contextBudgetChars: config.contextBudgetChars || 120_000,
    };
    this.workspace = new Workspace(this.config.workspace);
    this.bus = new MessageBus();
    this.events = new EventBus();
    this.agents = new Map();
    this.metrics = createMetrics();
    this.sessionLog = new SessionLog();
    this.files = new FileTracker(this.config.workspace);
    this.checkpoints = new CheckpointStore(this.config.workspace);
    this.sessions = new SessionManager(this.config.workspace);
    try {
      this.sessions.ensureActive({ goal: this.goal });
    } catch { /* */ }

    // Personalities/templates prefer packaged defaults/ until user installs (~/.arrowcode)
    try {
      seedTemplates();
      seedAgentPersonalities();
    } catch { /* packaged fallbacks */ }
    try {
      this.goal = loadGoal();
    } catch {
      this.goal = null;
    }
    // journal is no-op-ish if home missing
    try {
      journal(`harness_start workspace=${this.workspace.root}`);
    } catch { /* */ }

    // Swarm engine (factory closes over this.swarm after assignment)
    const self = this;
    this.swarm = new SwarmEngine(
      this.config,
      this.workspace,
      this.bus,
      this.events,
      (args) => {
        const handle = createSwarmWorkerHandle({
          ...args,
          swarm: self.swarm,
          onFinished: args.onFinished,
          trackFile: (kind, path, contentAfter) => {
            if (kind === "write" || kind === "edit" || kind === "delete") {
              try {
                self.checkpoints.create(`${args.id}:${kind}`, [path]);
              } catch { /* */ }
            }
            self.files.record(kind, path, args.id, contentAfter);
            self.sessionLog.push("file", `${kind} ${path}`, { agent: args.id });
            try { self.sessions.touchFile(path); } catch { /* */ }
          },
        });
        // keep mutable spec object
        const spec = {
          id: args.id,
          parentId: args.parentId,
          role: args.role,
          task: args.task,
          depth: args.depth,
          endpoint: args.endpoint,
          status: handle.getStatus(),
          createdAt: Date.now(),
        };
        handle.spec = spec as typeof handle.spec;
        return handle;
      },
    );

    for (const id of AGENT_ORDER) {
      const w = new AgentWorker({
        id,
        rootId: id,
        config: this.config,
        workspace: this.workspace,
        bus: this.bus,
        events: this.events,
        swarm: this.swarm,
        trackFile: (kind, path, contentAfter) => {
          if (kind === "write" || kind === "edit" || kind === "delete") {
            try {
              this.checkpoints.create(`${id}:${kind}`, [path]);
            } catch { /* */ }
          }
          this.files.record(kind, path, id, contentAfter);
          this.sessionLog.push("file", `${kind} ${path}`, { agent: id });
          try { this.sessions.touchFile(path); } catch { /* */ }
        },
      });
      w.setApprovalHandler(async (tool, args) => {
        return this.gateTool(id, tool, args);
      });
      w.setHooks({
        onPlan: (p) => {
          if (!p) return;
          this.setPlan(p);
        },
        onQuestions: (qs) => this.setQuestions(qs),
        onReady: (summary) => this.onReady(summary),
      });
      w.updateContext({ phase: this.phase, goal: this.goal, plan: this.plan });
      this.agents.set(id, w);
    }

    this.bus.subscribe((msg) => {
      this.events.emit({ type: "bus", message: msg });
      if (msg.kind === "spawn") this.metrics.spawns += 1;
    });

    this.events.on((e) => {
      if (e.type === "agent_tool") this.metrics.toolCalls += 1;
      if (e.type === "agent_log" && e.line.kind === "error") this.metrics.errors += 1;
      if (e.type === "agent_tokens") {
        // approximate: last values are cumulative per agent — not summed here
      }
      if (e.type === "swarm" && e.action === "spawn") this.metrics.spawns += 1;
      if (e.type === "cycle") this.metrics.cycles = e.n;
    });

    if (this.goal) this.events.emit({ type: "goal", goal: this.goal });
  }

  private syncAgentContext() {
    this.swarm.updateConfig(this.config);
    let mem = "";
    try {
      mem = this.sessions.contextBlock();
    } catch {
      mem = "";
    }
    for (const a of this.agents.values()) {
      a.updateContext({
        phase: this.phase,
        goal: this.goal,
        plan: this.plan,
        config: this.config,
        sessionMemory: mem,
      });
      a.setSwarm(this.swarm);
    }
  }

  private setPhase(phase: SessionPhase, detail?: string) {
    this.phase = phase;
    this.syncAgentContext();
    this.events.emit({ type: "phase", phase, detail });
    this.events.emit({
      type: "system",
      text: detail || `Phase: ${phase}`,
    });
    this.sessionLog.push("phase", phase, { detail });
    try { this.sessions.updatePhase(phase); } catch { /* */ }
  }

  private setPlan(plan: PlanDoc) {
    this.plan = plan;
    try {
      const planOut = isUserHomePresent()
        ? PLAN_PATH
        : join(this.workspace.root, ".arrow-plan.md");
      if (isUserHomePresent()) ensureArrowHome();
      writeFileSync(
        planOut,
        `# ${plan.title}\n\n## Summary\n${plan.summary}\n\n## Steps\n${plan.steps.map((s, i) => `${i + 1}. ${s}`).join("\n")}\n\n## Risks\n${plan.risks.map((r) => `- ${r}`).join("\n")}\n\n## Acceptance\n${plan.acceptance.map((a) => `- ${a}`).join("\n")}\n\n## Assignments\n${Object.entries(plan.agents)
          .map(([k, v]) => `- ${k}: ${v}`)
          .join("\n")}\n`,
        "utf8",
      );
    } catch {
      /* */
    }
    this.metrics.plans += 1;
    try { journal(`plan title=${plan.title}`); } catch { /* */ }
    this.sessionLog.push("plan", plan.title, { detail: plan.summary });
    try { this.sessions.updatePlan(plan); this.sessions.addDecision(`Plan: ${plan.title}`); } catch { /* */ }
    this.events.emit({ type: "plan", plan });
    this.setPhase(
      "await_confirm",
      `Plan ready: ${plan.title} — type /confirm to execute, or send feedback`,
    );
  }

  private setQuestions(qs: string[]) {
    // merge unique
    const existing = new Set(this.questions.map((q) => q.question));
    for (const q of qs) {
      if (!existing.has(q)) {
        this.questions.push({
          id: `q${this.questions.length + 1}`,
          question: q,
        });
      }
    }
    // cap 7
    this.questions = this.questions.slice(0, 7);
    this.metrics.questions = this.questions.length;
    this.events.emit({ type: "questions", questions: [...this.questions] });
    this.setPhase(
      "questions",
      `Answer questions (${this.questions.filter((q) => !q.answer).length} open), then plan continues`,
    );
  }

  private onReady(summary: string) {
    this.events.emit({ type: "final", text: summary });
    this.setPhase(
      "await_accept",
      "Work ready for review — /accept to finish, /reject to continue, /stop to halt",
    );
    this.runActive = false;
  }

  private requestApproval(
    agent: AgentRef,
    tool: string,
    args: Record<string, unknown>,
  ): Promise<boolean> {
    const id = `appr_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    let preview = "";
    try {
      preview = JSON.stringify(args).slice(0, 400);
    } catch {
      preview = String(args);
    }
    this.events.emit({
      type: "approval_request",
      id,
      agent,
      tool,
      argsPreview: preview,
    });
    return new Promise<boolean>((resolve) => {
      this.pendingApprovals.set(id, { resolve, agent, tool });
    });
  }

  resolveApproval(id: string, allowed: boolean) {
    const p = this.pendingApprovals.get(id);
    if (!p) return;
    this.pendingApprovals.delete(id);
    this.events.emit({ type: "approval_resolved", id, allowed });
    p.resolve(allowed);
  }

  setAutoApprove(v: boolean) {
    this.config.autoApprove = v;
    this.syncAgentContext();
  }

  updateConfig(partial: Partial<ArrowConfig>) {
    this.config = { ...this.config, ...partial };
    this.syncAgentContext();
  }

  setGoalText(text: string, templateId?: string) {
    this.goal = createGoalFromText(text, templateId || this.config.templateId);
    this.config.goal = this.goal.text;
    this.config.templateId = this.goal.templateId;
    this.events.emit({ type: "goal", goal: this.goal });
    try { this.sessions.updateGoal(this.goal); } catch { /* */ }
    this.syncAgentContext();
  }

  applyTemplate(id: string) {
    const t = getTemplate(id);
    if (!t) {
      this.events.emit({ type: "system", text: `Unknown template: ${id}` });
      return;
    }
    this.config.templateId = id;
    if (this.goal) {
      this.goal.templateId = id;
      this.goal.checklist = t.checklist.map((c, i) => ({
        id: `c${i + 1}`,
        text: c,
        done: false,
      }));
      saveGoal(this.goal);
      this.events.emit({ type: "goal", goal: this.goal });
    }
    this.syncAgentContext();
    this.events.emit({
      type: "system",
      text: `Template set: ${t.name} — ${t.description}`,
    });
  }

  listTemplates() {
    return listTemplates();
  }

  /**
   * Start planning flow for a user prompt (does not execute until /confirm).
   */
  async startPlan(prompt: string): Promise<void> {
    this.stopFlag = false;
    // ensure goal
    if (!this.goal?.text?.trim()) {
      this.setGoalText(prompt, this.config.templateId);
    } else if (prompt.trim() && prompt.trim() !== this.goal.text.trim()) {
      // append intent
      this.goal.text = `${this.goal.text.trim()}\n\n## Current request\n${prompt.trim()}`;
      saveGoal(this.goal);
      this.events.emit({ type: "goal", goal: this.goal });
    }

    this.questions = [];
    this.plan = null;
    this.cycle = 0;
    this.setPhase("planning", "Planning…");
    this.events.emit({ type: "run_start", prompt });
    this.runActive = true;

    const orch = this.agents.get("orchestrator")!;
    const tmpl = this.goal?.templateId
      ? getTemplate(this.goal.templateId)
      : undefined;

    orch.assign(
      [
        "[mode=plan]",
        "Create a plan for the active goal. First explore the repo briefly if needed.",
        "If requirements are ambiguous, emit ```arrow-questions``` with 3–7 sharp questions.",
        "If you have enough info, emit ```arrow-plan``` (do NOT implement yet).",
        "",
        goalContextBlock(this.goal),
        tmpl ? `\nTemplate guidance:\n${tmpl.body}` : "",
        "",
        `User request:\n${prompt}`,
      ].join("\n"),
    );

    await this.waitUntilIdle(8 * 60 * 1000);
    this.runActive = false;
    if (this.phase === "planning") {
      // model neither asked nor planned — nudge
      this.events.emit({
        type: "system",
        text: "Planning turn finished. If no plan appeared, refine with more detail or /plan again.",
      });
    }
  }

  /** Record answers to open questions and continue planning. */
  async answerQuestions(text: string): Promise<void> {
    // Support "1. ans" multi-line or freeform dump
    const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
    let answered = 0;
    for (const line of lines) {
      const m = line.match(/^(\d+)[\).:\-]\s*(.+)$/);
      if (m) {
        const idx = Number(m[1]) - 1;
        if (this.questions[idx]) {
          this.questions[idx]!.answer = m[2];
          answered++;
        }
      }
    }
    // freeform: fill first unanswered
    if (!answered && text.trim()) {
      const open = this.questions.find((q) => !q.answer);
      if (open) {
        open.answer = text.trim();
        answered = 1;
      } else {
        // treat as general feedback
        this.questions.push({
          id: `q${this.questions.length + 1}`,
          question: "(user note)",
          answer: text.trim(),
        });
      }
    }

    this.events.emit({ type: "questions", questions: [...this.questions] });
    const still = this.questions.filter((q) => !q.answer);
    this.runActive = true;
    this.setPhase("questions", "Incorporating answers…");

    const qaBlock = this.questions
      .map((q, i) => `${i + 1}. ${q.question}\n   A: ${q.answer || "(pending)"}`)
      .join("\n");

    this.agents.get("orchestrator")!.assign(
      [
        "[mode=plan-continue]",
        "User answered clarifying questions:",
        qaBlock,
        still.length
          ? `Still open: ${still.length}. Ask only remaining essential questions OR produce \`\`\`arrow-plan\`\`\` if enough.`
          : "All answered. Produce ```arrow-plan``` now. Do not implement.",
        goalContextBlock(this.goal),
      ].join("\n"),
    );

    await this.waitUntilIdle(8 * 60 * 1000);
    this.runActive = false;
  }

  /** Confirm plan and start continuous execute loop until ready/accept/stop. */
  async confirmAndExecute(): Promise<void> {
    if (!this.plan) {
      this.events.emit({
        type: "system",
        text: "No plan to confirm. Run /plan first.",
      });
      return;
    }
    this.plan.confirmedAt = Date.now();
    this.stopFlag = false;
    this.setPhase("executing", "Plan confirmed — executing");
    this.runActive = true;
    this.events.emit({ type: "run_start", prompt: this.plan.title });

    const fe = this.agents.get("frontend")!;
    const be = this.agents.get("backend")!;
    const qa = this.agents.get("tester")!;
    const orch = this.agents.get("orchestrator")!;

    const assign = this.plan.agents;
    fe.assign(
      `[execute] Plan confirmed.\nYour assignment: ${assign.frontend || "frontend portions of the plan"}\n${goalContextBlock(this.goal)}\n\nPlan:\n${this.plan.raw}`,
    );
    be.assign(
      `[execute] Plan confirmed.\nYour assignment: ${assign.backend || "backend portions of the plan"}\n${goalContextBlock(this.goal)}\n\nPlan:\n${this.plan.raw}`,
    );
    qa.assign(
      `[execute] Plan confirmed.\nYour assignment: ${assign.tester || "verify FE/BE and tests"}\n${goalContextBlock(this.goal)}\n\nPlan:\n${this.plan.raw}`,
    );
    orch.assign(
      [
        "[mode=execute]",
        "Plan is CONFIRMED. Coordinate FE/BE/QA via message_agent.",
        "Use spawn_worker for parallel subtasks (swarm). Check swarm_status.",
        "Drive until the work is ready for user acceptance.",
        "When ready, emit ```arrow-ready``` with verification notes.",
        "Loop on failures. Do not stop early without ready or a hard block.",
        goalContextBlock(this.goal),
        `Plan:\n${this.plan.raw}`,
      ].join("\n"),
    );

    const max = this.config.maxExecuteCycles || 12;
    while (!this.stopFlag && this.phase === "executing" && this.cycle < max) {
      this.cycle++;
      this.events.emit({ type: "cycle", n: this.cycle, max });
      await this.waitUntilIdle(10 * 60 * 1000);
      if (this.phase !== "executing" || this.stopFlag) break;

      // If agents went idle without ready, nudge orchestrator
      if (!this.stopFlag && this.phase === "executing") {
        orch.assign(
          [
            "[mode=execute-continue]",
            `Execute cycle ${this.cycle}/${max}.`,
            "Inspect progress via tools/bus. Re-task FE/BE/QA as needed.",
            "If complete, emit ```arrow-ready```. If blocked, state the block clearly.",
            goalContextBlock(this.goal),
          ].join("\n"),
        );
      }
    }

    if (this.phase === "executing" && this.cycle >= max) {
      this.setPhase(
        "await_accept",
        `Reached max cycles (${max}). Review and /accept, /reject to continue, or /stop.`,
      );
    }
    this.runActive = false;
    this.events.emit({ type: "run_end", ok: this.phase !== "stopped" });
  }

  /** User rejects ready state — continue executing. */
  async rejectAndContinue(note?: string): Promise<void> {
    this.setPhase("executing", "Continuing after reject");
    this.runActive = true;
    this.agents.get("orchestrator")!.assign(
      `[mode=execute-continue]\nUser rejected current result.\n${note || "Improve and complete the goal."}\nEmit \`\`\`arrow-ready\`\`\` when truly done.\n${goalContextBlock(this.goal)}`,
    );
    await this.confirmLoopOnly();
  }

  private async confirmLoopOnly() {
    const max = this.config.maxExecuteCycles || 12;
    while (!this.stopFlag && this.phase === "executing" && this.cycle < max) {
      this.cycle++;
      this.events.emit({ type: "cycle", n: this.cycle, max });
      await this.waitUntilIdle(10 * 60 * 1000);
      if (this.phase !== "executing") break;
      this.agents.get("orchestrator")!.assign(
        `[mode=execute-continue] cycle ${this.cycle}/${max}. Continue toward goal. Ready? use arrow-ready.\n${goalContextBlock(this.goal)}`,
      );
    }
    this.runActive = false;
  }

  accept(note?: string) {
    this.stopFlag = true;
    this.runActive = false;
    this.metrics.accepts += 1;
    this.sessionLog.push("accept", note || "accepted");
    try { this.sessions.complete("completed"); this.sessions.appendNote(note || "accepted"); try { this.sessions.saveNow(); } catch { /* */ } } catch { /* */ }
    if (this.goal) {
      for (const c of this.goal.checklist) c.done = true;
      saveGoal(this.goal);
      this.events.emit({ type: "goal", goal: this.goal });
    }
    journal(`accept ${note || ""} | ${formatMetrics(this.metrics)}`);
    try {
      writeSessionSnapshot(
        `accept_${Date.now()}`,
        {
          goal: this.goal,
          plan: this.plan,
          metrics: this.metrics,
          phase: "accepted",
        },
        this.workspace.root,
      );
    } catch {
      /* */
    }
    this.setPhase("accepted", note || "Goal accepted.");
    this.events.emit({ type: "run_end", ok: true });
    this.events.emit({
      type: "final",
      text: note || "Accepted. Goal complete.",
    });
  }

  exportReplay(name?: string): string {
    return this.sessionLog.exportPath(name, this.workspace.root);
  }

  metricsLine(): string {
    // fold live agent tokens
    let tin = 0;
    let tout = 0;
    for (const a of this.agents.values()) {
      tin += a.tokenIn;
      tout += a.tokenOut;
    }
    const sw = this.swarm.stats();
    this.metrics.tokensIn = tin + sw.tokenIn;
    this.metrics.tokensOut = tout + sw.tokenOut;
    return formatMetrics(this.metrics);
  }

  stop() {
    this.stopFlag = true;
    this.runActive = false;
    this.swarm.stopAll();
    this.setPhase("stopped", "Stopped by user.");
    this.events.emit({ type: "run_end", ok: false });
  }

  swarmTree(): string {
    return formatSwarmTree(AGENT_ORDER, this.swarm);
  }

  /** Default entry: always plan first (gated flow). */
  async run(prompt: string): Promise<void> {
    await this.startPlan(prompt);
  }

  isRunning() {
    return this.runActive;
  }

  private async waitUntilIdle(maxMs: number): Promise<void> {
    const started = Date.now();
    let idleSince: number | null = null;
    await new Promise<void>((resolve) => {
      const tick = () => {
        if (this.stopFlag) {
          resolve();
          return;
        }
        if (Date.now() - started > maxMs) {
          resolve();
          return;
        }
        const busy =
          AGENT_ORDER.some((id) => this.agents.get(id)!.isBusy()) ||
          this.swarm.anyBusy();
        if (busy) {
          idleSince = null;
          setTimeout(tick, 120);
          return;
        }
        if (idleSince == null) idleSince = Date.now();
        if (Date.now() - idleSince >= 400) {
          resolve();
          return;
        }
        setTimeout(tick, 120);
      };
      setTimeout(tick, 120);
    });
  }

  resetAll() {
    for (const a of this.agents.values()) a.reset();
    this.phase = "idle";
    this.plan = null;
    this.questions = [];
    this.cycle = 0;
    this.syncAgentContext();
    this.events.emit({ type: "phase", phase: "idle" });
  }


  // ---- Session management API ----
  sessionNew(name?: string) {
    const s = this.sessions.create({ name, goal: this.goal });
    this.events.emit({ type: "system", text: `Session created: ${s.meta.id}` });
    return s.meta.id;
  }

  sessionList(): string {
    return this.sessions.statusText();
  }

  sessionLoad(id: string): string {
    const s = this.sessions.load(id);
    if (!s) return `Session not found: ${id}`;
    if (s.meta.goal) this.goal = s.meta.goal;
    if (s.plan) this.plan = s.plan;
    this.phase = s.meta.phase;
    this.syncAgentContext();
    this.events.emit({ type: "system", text: `Resumed session ${s.meta.id} (${s.meta.phase})` });
    if (s.meta.goal) this.events.emit({ type: "goal", goal: s.meta.goal });
    if (s.plan) this.events.emit({ type: "plan", plan: s.plan });
    return `Loaded ${s.meta.id}`;
  }

  sessionSave(): string {
    this.sessions.save();
    const id = this.sessions.active?.meta.id || "?";
    return `Saved session ${id}`;
  }

  sessionMemory(note?: string): string {
    if (note) {
      this.sessions.appendNote(note);
      return `Appended to session memory (${note.slice(0, 60)})`;
    }
    return this.sessions.contextBlock();
  }

  sessionDelete(id: string): string {
    return this.sessions.delete(id) ? `Deleted ${id}` : `Not found ${id}`;
  }



  chat(line: string) {
    // During questions phase, treat as answers
    if (this.phase === "questions") {
      void this.answerQuestions(line);
      return;
    }
    if (this.phase === "await_confirm") {
      // feedback on plan
      this.agents.get("orchestrator")!.assign(
        `[plan-feedback]\nUser:\n${line}\n\nRevise \`\`\`arrow-plan\`\`\` if needed. Still do not implement until confirmed.`,
      );
      return;
    }

    const m = line.match(
      /^@(orch|orchestrator|fe|frontend|be|backend|qa|tester|all)\b\s*/i,
    );
    if (m) {
      const tag = m[1]!.toLowerCase();
      const rest = line.slice(m[0].length);
      const map: Record<string, AgentId | "all"> = {
        orch: "orchestrator",
        orchestrator: "orchestrator",
        fe: "frontend",
        frontend: "frontend",
        be: "backend",
        backend: "backend",
        qa: "tester",
        tester: "tester",
        all: "all",
      };
      const to = map[tag] || "orchestrator";
      if (to === "all") {
        for (const id of AGENT_ORDER) this.agents.get(id)!.assign(rest);
      } else {
        this.agents.get(to)!.assign(rest);
      }
      return;
    }

    // default: if idle, start plan; if executing, route to orch
    if (
      this.phase === "idle" ||
      this.phase === "accepted" ||
      this.phase === "stopped"
    ) {
      void this.startPlan(line);
      return;
    }
    this.agents.get("orchestrator")!.assign(line);
  }
  private async gateTool(
    agent: AgentRef,
    tool: string,
    args: Record<string, unknown>,
  ): Promise<boolean> {
    const tokens =
      this.metrics.tokensIn +
      this.metrics.tokensOut +
      [...this.agents.values()].reduce((n, a) => n + a.tokenIn + a.tokenOut, 0);
    const decision = evaluateToolPolicy(tool, args, this.policy, {
      autoApprove: this.config.autoApprove,
      tokensUsed: tokens,
    });
    if (!decision.allow) {
      this.sessionLog.push("error", decision.reason, { agent: String(agent) });
      this.events.emit({ type: "system", text: decision.reason });
      return false;
    }
    if (decision.autoApprove || this.config.autoApprove) return true;
    return this.requestApproval(agent, tool, args);
  }

  undo(id?: string): string {
    const r = this.checkpoints.restore(id);
    this.sessionLog.push("system", r.message);
    this.events.emit({ type: "system", text: r.message });
    return r.message;
  }

  listCheckpoints() {
    return this.checkpoints.list();
  }

  setPolicy(partial: Partial<PolicyConfig>) {
    this.policy = { ...this.policy, ...partial };
    this.events.emit({
      type: "system",
      text: `Policy: dryRun=${this.policy.dryRun} budget=${this.policy.tokenBudget} allowlist=${this.policy.bashAllowlist} secrets=${this.policy.secretScan}`,
    });
  }

  async review(note?: string): Promise<void> {
    this.sessionLog.push("system", "review pass");
    const qa = this.agents.get("tester")!;
    qa.assign(
      [
        "[mode=review]",
        "Read-only review pass. Prefer diagnostics, grep, read_file, git_status, diff_workspace.",
        "You MAY add/update tests only. Avoid product code edits unless a critical bug blocks verification.",
        "Report findings by severity with file references.",
        note || "",
        this.plan ? `Plan:\n${this.plan.raw}` : "",
      ].join("\n"),
    );
  }


}
