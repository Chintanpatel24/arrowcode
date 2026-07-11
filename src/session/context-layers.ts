/**
 * Defines how session memory + hot context compose for each agent turn.
 *
 * Layers (highest priority last in prompt assembly, but all present):
 *   L0 System: role, personality, tools, phase, security rules
 *   L1 Project: ARROW.md, workspace snapshot, template
 *   L2 Goal + Plan
 *   L3 Session durable memory (SessionManager.contextBlock)
 *   L4 Hot window: recent messages (trim/summarize)
 *   L5 Live tool results (current turn)
 */

export const CONTEXT_LAYER_DOC = `
# Context layers

| Layer | Source | Lifetime | Budget |
|-------|--------|----------|--------|
| L0 System | personality + harness rules | process | fixed |
| L1 Project | ARROW.md, tree snapshot | workspace | ~12k chars |
| L2 Goal/Plan | goal.md / plan | session | ~8k |
| L3 Session memory | .arrowcode-sessions/<id>/memory | session durable | ~8k tail |
| L4 Hot window | agent messages | volatile | contextBudgetChars |
| L5 Tools | tool results | turn | truncated 80k |

When L4 exceeds summarizeThresholdChars → compact middle into L3 lastSummary.
When L4 still exceeds budget → trim oldest (keep system + recent).
`;

export function buildSessionMemoryMessage(block: string): {
  role: "user";
  content: string;
} {
  return {
    role: "user",
    content: `[session-memory]\n${block}\n\nUse this durable session memory; do not re-discover settled decisions.`,
  };
}
