/**
 * Lightning-fast context management — pure trim path without LLM summarize
 * when under hard deadline; optional async summarize later.
 */

import type OpenAI from "openai";
import { estimateChars, trimMessages, manageContext } from "../memory/context";
import type { LLMClient } from "../llm/client";
import { perf } from "./timers";

export interface FastContextOpts {
  budgetChars: number;
  summarizeThreshold: number;
  keepRecent: number;
  /** If true, skip LLM summarize (max speed) */
  pureTrimOnly?: boolean;
}

/**
 * Prefer pure trim for speed; only summarize when clearly over threshold
 * and pureTrimOnly is false.
 */
export async function manageContextFast(
  messages: OpenAI.Chat.ChatCompletionMessageParam[],
  llm: LLMClient,
  opts: FastContextOpts,
): Promise<{
  messages: OpenAI.Chat.ChatCompletionMessageParam[];
  didSummarize: boolean;
  didTrim: boolean;
  ms: number;
}> {
  return perf.timeAsync("context.manage", async () => {
    const size = estimateChars(messages);
    perf.inc("context.calls");
    perf.inc("context.chars_in", size);

    if (opts.pureTrimOnly || size < opts.summarizeThreshold) {
      if (size <= opts.budgetChars) {
        return { messages, didSummarize: false, didTrim: false, ms: 0 };
      }
      const trimmed = trimMessages(
        messages,
        opts.budgetChars,
        opts.keepRecent,
      );
      perf.inc("context.pure_trim");
      return {
        messages: trimmed,
        didSummarize: false,
        didTrim: true,
        ms: 0,
      };
    }

    const res = await manageContext(messages, llm, {
      budgetChars: opts.budgetChars,
      summarizeThreshold: opts.summarizeThreshold,
      keepRecent: opts.keepRecent,
    });
    if (res.didSummarize) perf.inc("context.summarize");
    if (res.didTrim) perf.inc("context.trim");
    return { ...res, ms: 0 };
  });
}

/** Fast hash for prompt cache keys */
export function fastHash(s: string): string {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}
