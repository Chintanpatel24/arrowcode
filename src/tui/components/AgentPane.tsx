import React, { useMemo } from "react";
import { Box, Text } from "ink";
import type { AgentId, AgentLogLine, AgentStatus, TodoItem } from "../../config/types";
import { AGENT_META } from "../../config/types";
import { statusColor, statusLabel } from "../theme";
// Pane shows live agent stream — no emoji, single-border boxes only.

export interface AgentPaneModel {
  id: AgentId;
  status: AgentStatus;
  detail?: string;
  logs: AgentLogLine[];
  todos: TodoItem[];
  tokenIn: number;
  tokenOut: number;
  toolCalls: number;
  currentTool?: string;
}

export function AgentPane(props: {
  model: AgentPaneModel;
  width: number;
  height: number;
}) {
  const { model, width, height } = props;
  const meta = AGENT_META[model.id];
  const border = borderFor(model.status);
  const bodyH = Math.max(3, height - 3);

  // Collapse consecutive "say" tokens into lines for display
  const lines = useMemo(() => formatLogs(model.logs, bodyH - 1), [model.logs, bodyH]);

  return (
    <Box
      flexDirection="column"
      borderStyle="single"
      borderColor={border}
      width={width}
      height={height}
      paddingX={1}
    >
      <Box justifyContent="space-between">
        <Text>
          <Text color="white" bold>
            {meta.short}
          </Text>
          <Text color="gray"> {meta.title}</Text>
        </Text>
        <Text>
          <Text color={statusColor(model.status)} bold>
            {statusLabel(model.status)}
          </Text>
          {model.currentTool ? (
            <Text color="gray"> {truncate(model.currentTool, Math.max(8, width - 28))}</Text>
          ) : model.detail ? (
            <Text color="gray"> {truncate(model.detail, Math.max(8, width - 28))}</Text>
          ) : null}
        </Text>
      </Box>
      <Box>
        <Text color="gray" dimColor>
          tools {model.toolCalls}  tok {model.tokenIn}/{model.tokenOut}
        </Text>
      </Box>
      <Box flexDirection="column" height={bodyH}>
        {lines.length === 0 ? (
          <Text color="gray" dimColor>
            waiting...
          </Text>
        ) : (
          lines.map((ln, i) => (
            <Text key={i} wrap="truncate">
              {ln}
            </Text>
          ))
        )}
      </Box>
    </Box>
  );
}

function borderFor(s: AgentStatus): string {
  if (s === "error" || s === "blocked") return "red";
  if (s === "done") return "green";
  if (s === "waiting") return "yellow";
  if (s === "thinking" || s === "tool") return "cyan";
  return "gray";
}

function truncate(s: string, n: number) {
  const t = s.replace(/\s+/g, " ");
  return t.length <= n ? t : t.slice(0, n - 1) + "~";
}

function formatLogs(logs: AgentLogLine[], maxLines: number): string[] {
  // Merge say tokens into buffer lines
  const out: string[] = [];
  let sayBuf = "";
  const flushSay = () => {
    if (!sayBuf) return;
    // wrap roughly
    const parts = sayBuf.replace(/\r/g, "").split("\n");
    for (const p of parts) {
      if (p.length === 0) continue;
      out.push(colorize("say", p));
    }
    sayBuf = "";
  };

  for (const l of logs) {
    if (l.kind === "say") {
      sayBuf += l.text;
      if (sayBuf.includes("\n") || sayBuf.length > 200) flushSay();
      continue;
    }
    flushSay();
    const prefix =
      l.kind === "tool"
        ? " > "
        : l.kind === "result"
          ? " < "
          : l.kind === "error"
            ? " ! "
            : l.kind === "think"
              ? " ~ "
              : " · ";
    out.push(colorize(l.kind, prefix + l.text.replace(/\s+/g, " ").slice(0, 200)));
  }
  flushSay();
  return out.slice(-maxLines);
}

function colorize(kind: string, text: string): string {
  // Ink Text children as plain string — color applied by parent not possible per-line easily
  // Return plain; AgentPane uses mono. Prefix distinguishes kinds.
  return text;
}
