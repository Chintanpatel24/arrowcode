import type { AgentRef, TaskEnvelope } from "../config/types";

type Handler = (msg: TaskEnvelope) => void;

/**
 * In-process message bus for main agents + swarm workers.
 * Supports exact id delivery and "all" broadcast to main squad.
 */
export class MessageBus {
  private handlers = new Map<string, Set<Handler>>();
  private history: TaskEnvelope[] = [];
  private listeners: Array<(msg: TaskEnvelope) => void> = [];

  on(agent: AgentRef | "all", handler: Handler): () => void {
    const key = String(agent);
    if (!this.handlers.has(key)) this.handlers.set(key, new Set());
    this.handlers.get(key)!.add(handler);
    return () => this.handlers.get(key)?.delete(handler);
  }

  subscribe(fn: (msg: TaskEnvelope) => void): () => void {
    this.listeners.push(fn);
    return () => {
      this.listeners = this.listeners.filter((x) => x !== fn);
    };
  }

  publish(
    msg: Omit<TaskEnvelope, "ts" | "id"> & { id?: string },
  ): TaskEnvelope {
    const full: TaskEnvelope = {
      id:
        msg.id ||
        `msg_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      from: msg.from,
      to: msg.to,
      kind: msg.kind,
      title: msg.title,
      body: msg.body,
      ts: Date.now(),
      meta: msg.meta,
    };
    this.history.push(full);
    if (this.history.length > 300) this.history.shift();

    for (const fn of this.listeners) {
      try {
        fn(full);
      } catch {
        /* */
      }
    }

    const deliver = (key: string) => {
      const set = this.handlers.get(key);
      if (!set) return;
      for (const h of set) {
        try {
          h(full);
        } catch {
          /* non-fatal */
        }
      }
    };

    if (full.to === "all") {
      for (const id of [
        "orchestrator",
        "frontend",
        "backend",
        "tester",
      ]) {
        if (id !== full.from) deliver(id);
      }
    } else {
      deliver(String(full.to));
    }
    return full;
  }

  getHistory(): TaskEnvelope[] {
    return [...this.history];
  }
}
