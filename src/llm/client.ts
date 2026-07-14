import OpenAI from "openai";
import type { EndpointConfig, ProviderId } from "../config/types";
import type { OpenAITool } from "../tools/types";

export interface ToolCall {
  id: string;
  name: string;
  arguments: string;
}

export interface LLMResponse {
  content: string | null;
  toolCalls: ToolCall[];
  finishReason?: string | null;
  usage: { prompt_tokens: number; completion_tokens: number };
}

export class LLMError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LLMError";
  }
}

/**
 * OpenAI-compatible client. Works with NVIDIA NIM, OpenAI, Ollama, vLLM, etc.
 * Construct one instance per agent endpoint.
 */
export class LLMClient {
  private client: OpenAI;
  private endpoint: EndpointConfig;
  readonly model: string;
  readonly provider: ProviderId;

  constructor(endpoint: EndpointConfig) {
    this.endpoint = endpoint;
    this.model = endpoint.model;
    this.provider = endpoint.provider;
    if (!endpoint.apiKey && endpoint.provider !== "ollama" && endpoint.provider !== "demo" && endpoint.provider !== "mock") {
      throw new LLMError(
        "No API key for this agent. Set global key or ARROW_<AGENT>_API_KEY / agents.yaml",
      );
    }
    this.client = new OpenAI({
      apiKey: endpoint.apiKey || "ollama",
      baseURL: endpoint.provider === "demo" || endpoint.provider === "mock" ? "http://demo-url" : endpoint.baseUrl,
      timeout: 120_000,
      maxRetries: 0,
    });
  }

  async chat(
    messages: OpenAI.Chat.ChatCompletionMessageParam[],
    tools?: OpenAITool[],
    opts?: { onToken?: (t: string) => void; stream?: boolean },
  ): Promise<LLMResponse> {
    if (this.provider === "demo" || this.provider === "mock") {
      // Mock LLM response generator for instant works/tryout!
      const userMessage = messages[messages.length - 1]?.content || "";
      let replyContent = "Let's explore the workspace and carry out your request.";
      const toolCalls: ToolCall[] = [];

      // Determine the kind of reply based on the message content
      const lower = typeof userMessage === "string" ? userMessage.toLowerCase() : "";
      if (lower.includes("[mode=plan]") || lower.includes("plan")) {
        replyContent = `\`\`\`arrow-plan
title: Demo Implementation Plan
summary: A mockup flow to demonstrate clean and fast execution.
steps:
  1. Explore local directories and files.
  2. Setup frontend core elements.
  3. Validate using offline tests.
risks:
  - Mock mode doesn't execute actual remote files.
acceptance:
  - UI works fine.
  - Tests pass with green indicators.
agents:
  frontend: Core UI setup
  backend: API endpoints mocking
  tester: Verify everything
\`\`\``;
      } else if (lower.includes("[execute]") || lower.includes("execute") || lower.includes("confirm")) {
        replyContent = `\`\`\`arrow-ready
Verification: Verified that all mock procedures ran fine and the application is highly optimized.
All tests are passing.
\`\`\``;
      } else if (lower.includes("health") || lower.includes("status")) {
        replyContent = "Everything is functioning correctly under the demo environment.";
      }

      if (opts?.onToken) {
        // simulate streaming
        const parts = replyContent.split(" ");
        for (const p of parts) {
          opts.onToken(p + " ");
          await Bun.sleep(5);
        }
      }

      return {
        content: replyContent,
        toolCalls,
        finishReason: "stop",
        usage: { prompt_tokens: messages.length * 10, completion_tokens: replyContent.length / 4 }
      };
    }

    const stream = Boolean(opts?.stream && opts.onToken);
    const body: OpenAI.Chat.ChatCompletionCreateParams = {
      model: this.model,
      messages,
      temperature: this.endpoint.temperature ?? 0.2,
      max_tokens: this.endpoint.maxTokens ?? 8192,
    };
    if (tools && tools.length) {
      body.tools = tools as unknown as OpenAI.Chat.ChatCompletionTool[];
      body.tool_choice = "auto";
    }

    let lastErr: unknown;
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        if (stream) return await this.streamChat(body, opts!.onToken!);
        const resp = await this.client.chat.completions.create({
          ...body,
          stream: false,
        });
        return this.parse(resp);
      } catch (e) {
        lastErr = e;
        const msg = String(e).toLowerCase();
        const retryable = [
          "rate",
          "429",
          "timeout",
          "503",
          "502",
          "overloaded",
          "econnreset",
          "fetch failed",
        ].some((x) => msg.includes(x));
        if (!retryable || attempt === 3) {
          throw new LLMError(`LLM request failed (${this.model}): ${e}`);
        }
        await Bun.sleep(1200 * (attempt + 1));
      }
    }
    throw new LLMError(`LLM request failed: ${lastErr}`);
  }

  /** Cheap non-streaming completion for summarization. */
  async complete(
    system: string,
    user: string,
    maxTokens = 800,
  ): Promise<string> {
    const resp = await this.chat(
      [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      undefined,
      { stream: false },
    );
    return resp.content || "";
  }

  private async streamChat(
    body: OpenAI.Chat.ChatCompletionCreateParams,
    onToken: (t: string) => void,
  ): Promise<LLMResponse> {
    const stream = await this.client.chat.completions.create({
      ...body,
      stream: true,
    });
    const contentParts: string[] = [];
    const tcAcc = new Map<
      number,
      { id: string; name: string; arguments: string }
    >();
    let finish: string | null | undefined;
    const usage = { prompt_tokens: 0, completion_tokens: 0 };

    for await (const chunk of stream) {
      const choice = chunk.choices?.[0];
      if (!choice) continue;
      finish = choice.finish_reason || finish;
      const delta = choice.delta;
      if (delta?.content) {
        contentParts.push(delta.content);
        onToken(delta.content);
      }
      if (delta?.tool_calls) {
        for (const tc of delta.tool_calls) {
          const idx = tc.index ?? 0;
          const slot = tcAcc.get(idx) || {
            id: "",
            name: "",
            arguments: "",
          };
          if (tc.id) slot.id = tc.id;
          if (tc.function?.name) slot.name = tc.function.name;
          if (tc.function?.arguments)
            slot.arguments += tc.function.arguments;
          tcAcc.set(idx, slot);
        }
      }
    }

    const toolCalls: ToolCall[] = [...tcAcc.entries()]
      .sort((a, b) => a[0] - b[0])
      .filter(([, v]) => v.name)
      .map(([i, v]) => ({
        id: v.id || `call_${i}`,
        name: v.name,
        arguments: v.arguments || "{}",
      }));

    return {
      content: contentParts.join("") || null,
      toolCalls,
      finishReason: finish,
      usage,
    };
  }

  private parse(resp: OpenAI.Chat.ChatCompletion): LLMResponse {
    const choice = resp.choices[0];
    const msg = choice?.message;
    const toolCalls: ToolCall[] = (msg?.tool_calls || []).map((tc) => {
      const fn = "function" in tc ? tc.function : { name: "", arguments: "" };
      return {
        id: tc.id || "call_0",
        name: fn.name,
        arguments: fn.arguments || "{}",
      };
    });
    return {
      content: msg?.content ?? null,
      toolCalls,
      finishReason: choice?.finish_reason,
      usage: {
        prompt_tokens: resp.usage?.prompt_tokens || 0,
        completion_tokens: resp.usage?.completion_tokens || 0,
      },
    };
  }
}
