import React from "react";
import { Box, Text } from "ink";
import type { SessionEvent } from "../../core/session-log";

export function Timeline(props: {
  width: number;
  height: number;
  events: SessionEvent[];
}) {
  const { events, width, height } = props;
  const shown = events.slice(-Math.max(2, height - 2));
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
        TIMELINE
      </Text>
      {shown.length === 0 ? (
        <Text color="gray" dimColor>
          session events appear here
        </Text>
      ) : (
        shown.map((e) => (
          <Text key={e.id} wrap="truncate">
            <Text color={colorFor(e.kind)}>{pad(e.kind, 6)}</Text>
            <Text color="gray"> </Text>
            <Text>
              {(e.agent ? `${e.agent}: ` : "") + e.title}
            </Text>
          </Text>
        ))
      )}
    </Box>
  );
}

function pad(s: string, n: number) {
  return (s + "      ").slice(0, n);
}

function colorFor(kind: string): string {
  switch (kind) {
    case "error":
      return "red";
    case "plan":
      return "yellow";
    case "swarm":
      return "cyan";
    case "tool":
      return "magenta";
    case "final":
    case "accept":
      return "green";
    case "phase":
      return "blue";
    default:
      return "gray";
  }
}
