import type {
  AgentId,
  AgentLogLine,
  AgentRef,
  AgentStatus,
  TodoItem,
  TaskEnvelope,
  SessionPhase,
  PlanDoc,
  PlanQuestion,
  GoalState,
} from "../config/types";

export type HarnessEvent =
  | {
      type: "agent_status";
      agent: AgentRef;
      status: AgentStatus;
      detail?: string;
    }
  | { type: "agent_log"; agent: AgentRef; line: AgentLogLine }
  | { type: "agent_tool"; agent: AgentRef; name: string; detail: string }
  | {
      type: "agent_tokens";
      agent: AgentRef;
      tokenIn: number;
      tokenOut: number;
      toolCalls: number;
    }
  | { type: "agent_todos"; agent: AgentRef; todos: TodoItem[] }
  | { type: "bus"; message: TaskEnvelope }
  | { type: "system"; text: string }
  | {
      type: "approval_request";
      id: string;
      agent: AgentRef;
      tool: string;
      argsPreview: string;
    }
  | { type: "approval_resolved"; id: string; allowed: boolean }
  | { type: "run_start"; prompt: string }
  | { type: "run_end"; ok: boolean }
  | { type: "final"; text: string }
  | { type: "phase"; phase: SessionPhase; detail?: string }
  | { type: "plan"; plan: PlanDoc }
  | { type: "questions"; questions: PlanQuestion[] }
  | { type: "goal"; goal: GoalState | null }
  | { type: "cycle"; n: number; max: number }
  | {
      type: "swarm";
      action: "spawn" | "done" | "error" | "update";
      workerId: string;
      parentId: string;
      role?: string;
      task?: string;
      depth?: number;
      result?: string;
      active?: number;
      total?: number;
    };

type Listener = (e: HarnessEvent) => void;

export class EventBus {
  private listeners = new Set<Listener>();

  on(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit(e: HarnessEvent): void {
    for (const fn of this.listeners) {
      try {
        fn(e);
      } catch {
        /* UI errors should not kill harness */
      }
    }
  }
}
