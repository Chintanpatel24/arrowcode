/**
 * Context window management: estimate size, trim, and summarize.
 */

import type OpenAI from "openai";
import type { LLMClient } from "../llm/client";

export function estimateChars(
  messages: OpenAI.Chat.ChatCompletionMessageParam[],
): number {
  try {
    return JSON.stringify(messages).length;
  } catch {
    return messages.reduce((n, m) => n + JSON.stringify(m).length, 0);
  }
}

/**
 * Keep system[0], optional memory note, and last `keep` messages.
 * Drops from the front after system to fit `budgetChars`.
 */
export function trimMessages(
  messages: OpenAI.Chat.ChatCompletionMessageParam[],
  budgetChars: number,
  keepRecent: number,
): OpenAI.Chat.ChatCompletionMessageParam[] {
  if (messages.length <= 2) return messages;
  let total = estimateChars(messages);
  if (total <= budgetChars) return messages;

  const system = messages[0]?.role === "system" ? messages[0] : null;
  const rest = system ? messages.slice(1) : [...messages];

  // Always try to keep the last keepRecent
  while (rest.length > keepRecent && total > budgetChars) {
    rest.shift();
    total = estimateChars(system ? [system, ...rest] : rest);
  }

  // Still too big: hard-truncate oldest content strings
  if (total > budgetChars && rest.length) {
    for (let i = 0; i < rest.length - 2 && total > budgetChars; i++) {
      const m = rest[i]!;
      if (typeof m.content === "string" && m.content.length > 400) {
        const cut = m.content.slice(0, 200) + "\n...[trimmed]...\n" + m.content.slice(-200);
        rest[i] = { ...m, content: cut } as OpenAI.Chat.ChatCompletionMessageParam;
        total = estimateChars(system ? [system, ...rest] : rest);
      }
    }
  }

  const out = system ? [system, ...rest] : rest;
  // Ensure tool_call pairs aren't broken: drop orphan tool messages at front
  return sanitizeToolPairs(out);
}

function sanitizeToolPairs(
  messages: OpenAI.Chat.ChatCompletionMessageParam[],
): OpenAI.Chat.ChatCompletionMessageParam[] {
  const out: OpenAI.Chat.ChatCompletionMessageParam[] = [];
  const pending = new Set<string>();
  for (const m of messages) {
    if (m.role === "assistant" && "tool_calls" in m && Array.isArray((m as { tool_calls?: { id: string }[] }).tool_calls)) {
      const tcs = (m as { tool_calls: { id: string }[] }).tool_calls;
      for (const t of tcs) pending.add(t.id);
      out.push(m);
      continue;
    }
    if (m.role === "tool") {
      const id = (m as { tool_call_id?: string }).tool_call_id;
      if (id && pending.has(id)) {
        pending.delete(id);
        out.push(m);
      }
      // drop orphan tool results
      continue;
    }
    out.push(m);
  }
  return out;
}

/**
 * Summarize middle history into a single user/assistant pair.
 */
export async function compactWithSummary(
  messages: OpenAI.Chat.ChatCompletionMessageParam[],
  llm: LLMClient,
  keepRecent: number,
): Promise<OpenAI.Chat.ChatCompletionMessageParam[]> {
  if (messages.length < keepRecent + 4) return messages;
  const system = messages[0]?.role === "system" ? messages[0] : null;
  const start = system ? 1 : 0;
  const middle = messages.slice(start, Math.max(start, messages.length - keepRecent));
  const tail = messages.slice(Math.max(start, messages.length - keepRecent));

  if (middle.length < 2) return messages;

  const digest = middle
    .map((m) => {
      const role = m.role;
      let content = "";
      if (typeof m.content === "string") content = m.content.slice(0, 500);
      else if (m.role === "assistant" && "tool_calls" in m) {
        content = `[tools: ${JSON.stringify((m as { tool_calls?: unknown }).tool_calls).slice(0, 200)}]`;
      }
      return `[${role}] ${content}`;
    })
    .join("\n")
    .slice(0, 14_000);

  let summary: string;
  try {
    summary = await llm.complete(
      "You compress coding-agent history into dense bullets: goals, decisions, files changed, blockers, next steps. No preamble.",
      digest,
      700,
    );
  } catch {
    summary = digest.slice(0, 1500);
  }

  const compacted: OpenAI.Chat.ChatCompletionMessageParam[] = [];
  if (system) compacted.push(system);
  compacted.push({
    role: "user",
    content: `[memory] Compacted earlier turns:\n${summary}`,
  });
  compacted.push({
    role: "assistant",
    content: "Acknowledged compacted history. Continuing from recent context.",
  });
  compacted.push(...tail);
  return sanitizeToolPairs(compacted);
}

export async function manageContext(
  messages: OpenAI.Chat.ChatCompletionMessageParam[],
  llm: LLMClient,
  opts: {
    budgetChars: number;
    summarizeThreshold: number;
    keepRecent: number;
  },
): Promise<{
  messages: OpenAI.Chat.ChatCompletionMessageParam[];
  didSummarize: boolean;
  didTrim: boolean;
}> {
  let msgs = messages;
  let didSummarize = false;
  let didTrim = false;
  const size = estimateChars(msgs);

  if (size > opts.summarizeThreshold && msgs.length > opts.keepRecent + 3) {
    msgs = await compactWithSummary(msgs, llm, opts.keepRecent);
    didSummarize = true;
  }
  if (estimateChars(msgs) > opts.budgetChars) {
    const before = msgs.length;
    msgs = trimMessages(msgs, opts.budgetChars, opts.keepRecent);
    didTrim = msgs.length < before || estimateChars(msgs) < size;
  }
  return { messages: msgs, didSummarize, didTrim };
}
