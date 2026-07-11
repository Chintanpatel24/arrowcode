import React from "react";
import { Box, Text } from "ink";
import type { TaskEnvelope } from "../../config/types";

export function BusFeed(props: {
  messages: TaskEnvelope[];
  width: number;
  height: number;
}) {
  const { messages, width, height } = props;
  const lines = messages.slice(-(height - 2));
  return (
    <Box
      flexDirection="column"
      borderStyle="single"
      borderColor="gray"
      width={width}
      height={height}
      paddingX={1}
    >
      <Text color="gray" bold>
        AGENT BUS
      </Text>
      {lines.length === 0 ? (
        <Text color="gray" dimColor>
          no messages yet
        </Text>
      ) : (
        lines.map((m) => (
          <Text key={m.id} wrap="truncate">
            <Text color="cyan">{pad(m.from, 4)}</Text>
            <Text color="gray">{" -> "}</Text>
            <Text color="magenta">{pad(String(m.to), 4)}</Text>
            <Text color="gray"> [{m.kind}] </Text>
            <Text>{m.title.slice(0, Math.max(10, width - 28))}</Text>
          </Text>
        ))
      )}
    </Box>
  );
}

function pad(s: string, n: number) {
  const t =
    s === "orchestrator"
      ? "orch"
      : s === "frontend"
        ? "fe"
        : s === "backend"
          ? "be"
          : s === "tester"
            ? "qa"
            : s;
  return (t + "    ").slice(0, n);
}
