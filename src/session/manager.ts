/**
 * Session management — durable, workspace-first sessions.
 *
 * Storage (no global ~/.arrowcode required):
 *   <workspace>/.arrowcode-sessions/
 *     index.json
 *     <sessionId>/
 *       meta.json
 *       memory.md          # durable session memory (summaries, decisions)
 *       events.jsonl       # append-only timeline
 *       agents/            # optional per-agent message snapshots
 *
 * Context layers:
 *   1. System prompt + personality + ARROW.md + goal + plan
 *   2. Session memory.md (compressed long-term for this session)
 *   3. Hot conversation window (trim + summarize)
 *   4. Tool results (truncated)
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  appendFileSync,
  readdirSync,
  rmSync,
  statSync,
} from "node:fs";
import { join, resolve } from "node:path";
import type { GoalState, PlanDoc, SessionPhase, AgentId } from "../config/types";
import { AGENT_ORDER } from "../config/types";
import { SaveCoalescer } from "../perf/debounce";
import { perf } from "../perf/timers";

export interface SessionMeta {
  id: string;
  name: string;
  workspace: string;
  createdAt: number;
  updatedAt: number;
  phase: SessionPhase;
  goal?: GoalState | null;
  planTitle?: string;
  templateId?: string;
  tags: string[];
  /** Rolling token counters (best-effort) */
  tokensIn: number;
  tokensOut: number;
  toolCalls: number;
  status: "active" | "paused" | "completed" | "archived";
}

export interface SessionMemory {
  /** Free-form durable notes / compressed history */
  notes: string;
  decisions: string[];
  filesTouched: string[];
  openQuestions: string[];
  lastSummary?: string;
}

export interface SessionSnapshot {
  meta: SessionMeta;
  memory: SessionMemory;
  plan?: PlanDoc | null;
  /** Compact agent message digests for resume (not full tool dumps) */
  agentDigests?: Partial<Record<AgentId, string>>;
}

function safeId(name?: string): string {
  const base = (name || "session")
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return `${base || "session"}_${Date.now().toString(36)}`;
}

export class SessionManager {
  readonly workspace: string;
  readonly root: string; // .arrowcode-sessions
  private current: SessionSnapshot | null = null;
  private saver: SaveCoalescer;

  constructor(workspace: string) {
    this.workspace = resolve(workspace);
    this.root = join(this.workspace, ".arrowcode-sessions");
    this.saver = new SaveCoalescer(() => {
      if (!this.current) return;
      this.current.meta.updatedAt = Date.now();
      this.writeSnapshot(this.current);
      this.writeIndex();
      perf.inc("session.disk_saves");
    }, 250);
  }

  private ensureRoot() {
    mkdirSync(this.root, { recursive: true });
    // auto-ignore
    const gi = join(this.workspace, ".gitignore");
    try {
      if (existsSync(gi)) {
        const t = readFileSync(gi, "utf8");
        if (!t.includes(".arrowcode-sessions")) {
          writeFileSync(
            gi,
            t.trimEnd() + "\n.arrowcode-sessions/\n.arrowcode-checkpoints/\n",
            "utf8",
          );
        }
      }
    } catch {
      /* optional */
    }
  }

  private dir(id: string) {
    return join(this.root, id);
  }

  get active(): SessionSnapshot | null {
    return this.current;
  }

  list(): SessionMeta[] {
    if (!existsSync(this.root)) return [];
    const out: SessionMeta[] = [];
    for (const name of readdirSync(this.root)) {
      const mp = join(this.root, name, "meta.json");
      if (!existsSync(mp)) continue;
      try {
        out.push(JSON.parse(readFileSync(mp, "utf8")) as SessionMeta);
      } catch {
        /* skip */
      }
    }
    return out.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  create(opts?: {
    name?: string;
    goal?: GoalState | null;
    templateId?: string;
  }): SessionSnapshot {
    this.ensureRoot();
    const id = safeId(opts?.name);
    const now = Date.now();
    const meta: SessionMeta = {
      id,
      name: opts?.name || id,
      workspace: this.workspace,
      createdAt: now,
      updatedAt: now,
      phase: "idle",
      goal: opts?.goal ?? null,
      templateId: opts?.templateId,
      tags: [],
      tokensIn: 0,
      tokensOut: 0,
      toolCalls: 0,
      status: "active",
    };
    const memory: SessionMemory = {
      notes: "",
      decisions: [],
      filesTouched: [],
      openQuestions: [],
    };
    const snap: SessionSnapshot = { meta, memory, plan: null, agentDigests: {} };
    mkdirSync(this.dir(id), { recursive: true });
    mkdirSync(join(this.dir(id), "agents"), { recursive: true });
    this.writeSnapshot(snap);
    this.appendEvent(id, {
      kind: "system",
      title: "session_created",
      detail: meta.name,
    });
    this.current = snap;
    this.writeIndex();
    return snap;
  }

  /** Resume latest active session or create one */
  ensureActive(opts?: { name?: string; goal?: GoalState | null }): SessionSnapshot {
    if (this.current) return this.current;
    const listed = this.list().filter((m) => m.status === "active");
    if (listed[0]) {
      const loaded = this.load(listed[0].id);
      if (loaded) {
        this.current = loaded;
        return loaded;
      }
    }
    return this.create(opts);
  }

  load(id: string): SessionSnapshot | null {
    const dir = this.dir(id);
    const mp = join(dir, "meta.json");
    if (!existsSync(mp)) return null;
    try {
      const meta = JSON.parse(readFileSync(mp, "utf8")) as SessionMeta;
      let memory: SessionMemory = {
        notes: "",
        decisions: [],
        filesTouched: [],
        openQuestions: [],
      };
      const memPath = join(dir, "memory.json");
      if (existsSync(memPath)) {
        memory = JSON.parse(readFileSync(memPath, "utf8")) as SessionMemory;
      } else {
        const md = join(dir, "memory.md");
        if (existsSync(md)) memory.notes = readFileSync(md, "utf8");
      }
      let plan: PlanDoc | null = null;
      const planPath = join(dir, "plan.json");
      if (existsSync(planPath)) {
        plan = JSON.parse(readFileSync(planPath, "utf8")) as PlanDoc;
      }
      let agentDigests: Partial<Record<AgentId, string>> = {};
      const dig = join(dir, "digests.json");
      if (existsSync(dig)) {
        agentDigests = JSON.parse(readFileSync(dig, "utf8"));
      }
      const snap = { meta, memory, plan, agentDigests };
      this.current = snap;
      return snap;
    } catch {
      return null;
    }
  }

  save(): void {
    if (!this.current) return;
    this.current.meta.updatedAt = Date.now();
    this.saver.mark();
  }

  saveNow(): void {
    if (!this.current) return;
    this.current.meta.updatedAt = Date.now();
    this.saver.flush();
    this.writeSnapshot(this.current);
    this.writeIndex();
  }

  private writeSnapshot(snap: SessionSnapshot) {
    const dir = this.dir(snap.meta.id);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "meta.json"), JSON.stringify(snap.meta, null, 2));
    writeFileSync(join(dir, "memory.json"), JSON.stringify(snap.memory, null, 2));
    writeFileSync(
      join(dir, "memory.md"),
      this.renderMemoryMd(snap),
      "utf8",
    );
    if (snap.plan) {
      writeFileSync(join(dir, "plan.json"), JSON.stringify(snap.plan, null, 2));
    }
    writeFileSync(
      join(dir, "digests.json"),
      JSON.stringify(snap.agentDigests || {}, null, 2),
    );
  }

  private renderMemoryMd(snap: SessionSnapshot): string {
    const m = snap.memory;
    return [
      `# Session memory — ${snap.meta.name}`,
      ``,
      `id: ${snap.meta.id}`,
      `phase: ${snap.meta.phase}`,
      `status: ${snap.meta.status}`,
      `updated: ${new Date(snap.meta.updatedAt).toISOString()}`,
      ``,
      `## Notes`,
      m.notes || "(empty)",
      ``,
      `## Decisions`,
      ...(m.decisions.length ? m.decisions.map((d) => `- ${d}`) : ["- (none)"]),
      ``,
      `## Files touched`,
      ...(m.filesTouched.length
        ? m.filesTouched.map((f) => `- ${f}`)
        : ["- (none)"]),
      ``,
      `## Open questions`,
      ...(m.openQuestions.length
        ? m.openQuestions.map((q) => `- ${q}`)
        : ["- (none)"]),
      ``,
      m.lastSummary ? `## Last summary\n${m.lastSummary}\n` : "",
    ].join("\n");
  }

  private writeIndex() {
    this.ensureRoot();
    const index = this.list().map((m) => ({
      id: m.id,
      name: m.name,
      updatedAt: m.updatedAt,
      status: m.status,
      phase: m.phase,
    }));
    writeFileSync(join(this.root, "index.json"), JSON.stringify(index, null, 2));
  }

  appendEvent(
    id: string,
    ev: { kind: string; title: string; detail?: string; agent?: string },
  ) {
    try {
      const file = join(this.dir(id), "events.jsonl");
      mkdirSync(this.dir(id), { recursive: true });
      appendFileSync(
        file,
        JSON.stringify({ ts: Date.now(), ...ev }) + "\n",
        "utf8",
      );
    } catch {
      /* */
    }
  }

  updatePhase(phase: SessionPhase) {
    const s = this.ensureActive();
    s.meta.phase = phase;
    s.meta.updatedAt = Date.now();
    this.appendEvent(s.meta.id, { kind: "phase", title: phase });
    this.save();
  }

  updateGoal(goal: GoalState | null) {
    const s = this.ensureActive();
    s.meta.goal = goal;
    s.meta.updatedAt = Date.now();
    this.save();
  }

  updatePlan(plan: PlanDoc | null) {
    const s = this.ensureActive();
    s.plan = plan;
    s.meta.planTitle = plan?.title;
    s.meta.updatedAt = Date.now();
    this.appendEvent(s.meta.id, {
      kind: "plan",
      title: plan?.title || "cleared",
    });
    this.save();
  }

  touchFile(path: string) {
    const s = this.ensureActive();
    if (!s.memory.filesTouched.includes(path)) {
      s.memory.filesTouched.push(path);
      if (s.memory.filesTouched.length > 200) s.memory.filesTouched.shift();
    }
    s.meta.updatedAt = Date.now();
    // debounce disk: save every touch is ok for coding sessions
    this.save();
  }

  addDecision(text: string) {
    const s = this.ensureActive();
    s.memory.decisions.push(text.slice(0, 500));
    if (s.memory.decisions.length > 100) s.memory.decisions.shift();
    this.save();
  }

  appendNote(text: string) {
    const s = this.ensureActive();
    s.memory.notes =
      (s.memory.notes ? s.memory.notes + "\n\n" : "") +
      `### ${new Date().toISOString()}\n${text.slice(0, 4000)}`;
    // cap notes size
    if (s.memory.notes.length > 80_000) {
      s.memory.notes = s.memory.notes.slice(-60_000);
    }
    this.save();
  }

  setSummary(summary: string) {
    const s = this.ensureActive();
    s.memory.lastSummary = summary.slice(0, 4000);
    this.appendNote(`[compact] ${summary.slice(0, 1500)}`);
    this.save();
  }

  setAgentDigest(agent: AgentId, digest: string) {
    const s = this.ensureActive();
    s.agentDigests = s.agentDigests || {};
    s.agentDigests[agent] = digest.slice(0, 6000);
    try {
      writeFileSync(
        join(this.dir(s.meta.id), "agents", `${agent}.md`),
        digest.slice(0, 6000),
        "utf8",
      );
    } catch {
      /* */
    }
    this.save();
  }

  addTokens(tin: number, tout: number, tools = 0) {
    const s = this.ensureActive();
    s.meta.tokensIn += tin;
    s.meta.tokensOut += tout;
    s.meta.toolCalls += tools;
    // don't save every token tick — caller may batch
  }

  complete(status: "completed" | "archived" | "paused" = "completed") {
    const s = this.ensureActive();
    s.meta.status = status;
    s.meta.updatedAt = Date.now();
    this.appendEvent(s.meta.id, { kind: "system", title: `status_${status}` });
    this.save();
  }

  delete(id: string): boolean {
    const dir = this.dir(id);
    if (!existsSync(dir)) return false;
    rmSync(dir, { recursive: true, force: true });
    if (this.current?.meta.id === id) this.current = null;
    this.writeIndex();
    return true;
  }

  /**
   * Context block injected into agent system prompts for this session.
   */
  contextBlock(): string {
    const s = this.current;
    if (!s) return "No active session.";
    const m = s.memory;
    return [
      "## Session",
      `id: ${s.meta.id}`,
      `name: ${s.meta.name}`,
      `phase: ${s.meta.phase}`,
      `status: ${s.meta.status}`,
      `tokens: ${s.meta.tokensIn}/${s.meta.tokensOut} tools=${s.meta.toolCalls}`,
      "",
      "### Session memory (durable)",
      m.lastSummary ? `Summary: ${m.lastSummary}` : "",
      m.decisions.length
        ? "Decisions:\n" + m.decisions.slice(-12).map((d) => `- ${d}`).join("\n")
        : "",
      m.filesTouched.length
        ? "Files:\n" + m.filesTouched.slice(-30).map((f) => `- ${f}`).join("\n")
        : "",
      m.openQuestions.length
        ? "Open questions:\n" +
          m.openQuestions.slice(-8).map((q) => `- ${q}`).join("\n")
        : "",
      m.notes
        ? "Notes (tail):\n" + m.notes.slice(-2500)
        : "",
    ]
      .filter(Boolean)
      .join("\n");
  }

  /** Human-readable status for /sessions */
  statusText(): string {
    const list = this.list();
    const cur = this.current?.meta.id;
    if (!list.length) return "No sessions in workspace (.arrowcode-sessions/). Use /session new";
    return list
      .slice(0, 15)
      .map(
        (m) =>
          `${m.id === cur ? "*" : " "} ${m.id}  [${m.status}/${m.phase}]  ${m.name}  tok ${m.tokensIn}/${m.tokensOut}`,
      )
      .join("\n");
  }
}
