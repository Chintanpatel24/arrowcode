export interface ToolResult {
  success: boolean;
  output: string;
  error?: string;
  metadata?: Record<string, unknown>;
}

export interface ToolParameterSchema {
  type: "object";
  properties: Record<
    string,
    {
      type: string;
      description?: string;
      enum?: string[];
      items?: unknown;
    }
  >;
  required?: string[];
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: ToolParameterSchema;
  requiresApproval: boolean;
  readOnly: boolean;
  execute: (args: Record<string, unknown>) => Promise<ToolResult> | ToolResult;
}

export interface OpenAITool {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: ToolParameterSchema;
  };
}

export function toOpenAITools(tools: ToolDefinition[]): OpenAITool[] {
  return tools.map((t) => ({
    type: "function" as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    },
  }));
}

export function truncateResult(r: ToolResult, limit = 80_000): ToolResult {
  const text = r.success
    ? r.output || "(ok)"
    : `ERROR: ${r.error || "unknown"}${r.output ? "\n" + r.output : ""}`;
  if (text.length <= limit) return r;
  const half = Math.floor(limit / 2);
  const cut =
    text.slice(0, half) +
    `\n\n... [truncated ${text.length - limit} chars] ...\n\n` +
    text.slice(-half);
  return {
    ...r,
    output: r.success ? cut : cut,
    metadata: { ...r.metadata, truncated: true },
  };
}
