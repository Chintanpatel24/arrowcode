import React from "react";
import { Box, Text } from "ink";

export interface SwarmNode {
  id: string;
  role: string;
  status: string;
  depth: number;
  parentId?: string;
}

export function SwarmMap(props: {
  width: number;
  height: number;
  nodes: SwarmNode[];
  maxWorkers: number;
  active: number;
}) {
  const { nodes, width, height, maxWorkers, active } = props;
  const bodyH = Math.max(2, height - 2);
  const lines = nodes.slice(0, bodyH).map((n) => {
    const pad = "  ".repeat(Math.min(n.depth, 3));
    return `${pad}${short(n.id)} [${n.status}] ${n.role}`;
  });
  return (
    <Box
      flexDirection="column"
      borderStyle="single"
      borderColor="cyan"
      width={width}
      height={height}
      paddingX={1}
    >
      <Text color="cyan" bold>
        SWARM {active}/{maxWorkers}
      </Text>
      {lines.length === 0 ? (
        <Text color="gray" dimColor>
          no workers — agents may spawn_worker
        </Text>
      ) : (
        lines.map((l, i) => (
          <Text key={i} wrap="truncate" color="white">
            {l.slice(0, Math.max(10, width - 4))}
          </Text>
        ))
      )}
    </Box>
  );
}

function short(id: string) {
  if (id.length <= 22) return id;
  return id.slice(0, 10) + "…" + id.slice(-8);
}
