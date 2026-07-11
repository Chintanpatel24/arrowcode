/**
 * Swarm engine — main agents spawn depth-limited workers that share the bus
 * and report results back to parents. Global cap on concurrent workers.
 */

import type {
  AgentId,
  AgentRef,
  AgentStatus,
  ArrowConfig,
  EndpointConfig,
  WorkerSpec,
} from "../config/types";
import {
  AGENT_ORDER,
  isMainAgent,
  parentOfWorker,
  rootAgentOf,
} from "../config/types";
import { resolveEndpoint } from "../config/load";
import type { MessageBus } from "../core/bus";
import type { EventBus } from "../core/events";
import type { Workspace } from "../tools/workspace";

export interface SwarmWorkerHandle {
  spec: WorkerSpec;
  assign: (text: string) => void;
  isBusy: () => boolean;
  getStatus: () => AgentStatus;
  stop: () => void;
  tokenIn: number;
  tokenOut: number;
  toolCalls: number;
}

export type WorkerFactory = (args: {
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
  onFinished: (id: string, result: string) => void;
}) => SwarmWorkerHandle;

export class SwarmEngine {
  private workers = new Map<string, SwarmWorkerHandle>();
  private children = new Map<string, Set<string>>(); // parent -> child ids
  private seq = 0;
  private config: ArrowConfig;
  private factory: WorkerFactory;
  private workspace: Workspace;
  private bus: MessageBus;
  private events: EventBus;

  constructor(
    config: ArrowConfig,
    workspace: Workspace,
    bus: MessageBus,
    events: EventBus,
    factory: WorkerFactory,
  ) {
    this.config = config;
    this.workspace = workspace;
    this.bus = bus;
    this.events = events;
    this.factory = factory;
  }

  updateConfig(cfg: ArrowConfig) {
    this.config = cfg;
  }

  listWorkers(): WorkerSpec[] {
    return [...this.workers.values()].map((w) => w.spec);
  }

  activeCount(): number {
    return [...this.workers.values()].filter(
      (w) =>
        w.spec.status === "thinking" ||
        w.spec.status === "tool" ||
        w.spec.status === "waiting" ||
        w.spec.status === "spawning" ||
        w.isBusy(),
    ).length;
  }

  totalCount(): number {
    return this.workers.size;
  }

  anyBusy(): boolean {
    return [...this.workers.values()].some((w) => w.isBusy());
  }

  get(id: string): SwarmWorkerHandle | undefined {
    return this.workers.get(id);
  }

  childrenOf(parentId: string): string[] {
    return [...(this.children.get(parentId) || [])];
  }

  /**
   * Spawn a worker under parent. Returns worker id or error string.
   */
  spawn(opts: {
    parentId: AgentRef;
    role: string;
    task: string;
    endpointOverride?: Partial<EndpointConfig>;
  }): { ok: true; id: string } | { ok: false; error: string } {
    const swarm = this.config.swarm;
    if (!swarm.enabled) {
      return { ok: false, error: "Swarm disabled in settings" };
    }

    const parentDepth = this.depthOf(opts.parentId);
    const depth = parentDepth + 1;
    if (depth > swarm.maxDepth) {
      return {
        ok: false,
        error: `Max swarm depth ${swarm.maxDepth} exceeded (parent depth ${parentDepth})`,
      };
    }

    // count live non-finished workers
    const live = [...this.workers.values()].filter((w) => !w.spec.finishedAt);
    if (live.length >= swarm.maxWorkers) {
      return {
        ok: false,
        error: `Max workers ${swarm.maxWorkers} reached`,
      };
    }

    const kids = this.children.get(opts.parentId) || new Set();
    const activeKids = [...kids].filter((id) => {
      const w = this.workers.get(id);
      return w && !w.spec.finishedAt;
    });
    if (activeKids.length >= swarm.maxChildrenPerAgent) {
      return {
        ok: false,
        error: `Parent already has ${swarm.maxChildrenPerAgent} active children`,
      };
    }

    this.seq += 1;
    const short = opts.role
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "")
      .slice(0, 10) || "w";
    const id = `${opts.parentId}.${short}${this.seq}`;

    const root = rootAgentOf(String(opts.parentId));
    const baseEp = resolveEndpoint(this.config, root);
    const endpoint: EndpointConfig = {
      ...baseEp,
      ...opts.endpointOverride,
      model: opts.endpointOverride?.model || baseEp.model,
      apiKey: opts.endpointOverride?.apiKey || baseEp.apiKey,
      baseUrl: opts.endpointOverride?.baseUrl || baseEp.baseUrl,
      provider: opts.endpointOverride?.provider || baseEp.provider,
    };

    const spec: WorkerSpec = {
      id,
      parentId: opts.parentId,
      role: opts.role,
      task: opts.task,
      depth,
      endpoint,
      status: "spawning",
      createdAt: Date.now(),
    };

    const handle = this.factory({
      id,
      parentId: opts.parentId,
      role: opts.role,
      task: opts.task,
      depth,
      endpoint,
      config: this.config,
      workspace: this.workspace,
      bus: this.bus,
      events: this.events,
      onFinished: (wid, result) => this.onWorkerFinished(wid, result),
    });
    handle.spec = spec;
    this.workers.set(id, handle);
    if (!this.children.has(opts.parentId)) {
      this.children.set(opts.parentId, new Set());
    }
    this.children.get(opts.parentId)!.add(id);

    this.events.emit({
      type: "swarm",
      action: "spawn",
      workerId: id,
      parentId: String(opts.parentId),
      role: opts.role,
      task: opts.task,
      depth,
      active: this.activeCount(),
      total: this.totalCount(),
    });

    // Kick off with the task
    handle.assign(
      [
        `[swarm-task] You are worker ${id} (role: ${opts.role}, depth ${depth}).`,
        `Parent: ${opts.parentId}`,
        `Complete this task and report clearly. Prefer tools over prose.`,
        `When finished, summarize files changed and outcomes.`,
        ``,
        opts.task,
      ].join("\n"),
    );

    this.bus.publish({
      from: opts.parentId,
      to: id,
      kind: "spawn",
      title: `Spawned ${opts.role}`,
      body: opts.task,
      meta: { workerId: id, depth },
    });

    return { ok: true, id };
  }

  private onWorkerFinished(id: string, result: string) {
    const w = this.workers.get(id);
    if (!w) return;
    w.spec.finishedAt = Date.now();
    w.spec.status = "done";
    w.spec.result = result;

    this.events.emit({
      type: "swarm",
      action: "done",
      workerId: id,
      parentId: String(w.spec.parentId),
      role: w.spec.role,
      task: w.spec.task,
      depth: w.spec.depth,
      result: result.slice(0, 2000),
      active: this.activeCount(),
      total: this.totalCount(),
    });

    // Report to parent via bus
    this.bus.publish({
      from: id,
      to: w.spec.parentId,
      kind: "report",
      title: `Worker ${id} finished: ${w.spec.role}`,
      body: result.slice(0, 12_000),
      meta: { workerId: id },
    });

    // GC finished workers after a grace period (keep map small)
    setTimeout(() => {
      const cur = this.workers.get(id);
      if (cur?.spec.finishedAt) {
        this.workers.delete(id);
        this.children.get(String(cur.spec.parentId))?.delete(id);
      }
    }, 60_000);
  }

  stopAll() {
    for (const w of this.workers.values()) {
      try {
        w.stop();
      } catch {
        /* */
      }
    }
  }

  private depthOf(id: AgentRef): number {
    if (isMainAgent(String(id))) return 0;
    return String(id).split(".").length - 1;
  }

  /** Stats for TUI /cost */
  stats() {
    let tokenIn = 0;
    let tokenOut = 0;
    let toolCalls = 0;
    for (const w of this.workers.values()) {
      tokenIn += w.tokenIn;
      tokenOut += w.tokenOut;
      toolCalls += w.toolCalls;
    }
    return {
      workers: this.totalCount(),
      active: this.activeCount(),
      tokenIn,
      tokenOut,
      toolCalls,
      maxWorkers: this.config.swarm.maxWorkers,
      maxDepth: this.config.swarm.maxDepth,
    };
  }
}

export function formatSwarmTree(
  mainIds: AgentId[],
  engine: SwarmEngine,
): string {
  const lines: string[] = [];
  for (const id of mainIds) {
    lines.push(id);
    const walk = (pid: string, indent: string) => {
      for (const cid of engine.childrenOf(pid)) {
        const w = engine.get(cid);
        const st = w?.getStatus() || "idle";
        const role = w?.spec.role || "?";
        lines.push(`${indent}${cid} [${st}] ${role}`);
        walk(cid, indent + "  ");
      }
    };
    walk(id, "  ");
  }
  return lines.join("\n");
}

// re-export for consumers
export { AGENT_ORDER, parentOfWorker };
