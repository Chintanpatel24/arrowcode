import React from "react";
import { Box, Text } from "ink";
import type { AgentId, AgentStatus } from "../../config/types";
import { AGENT_META } from "../../config/types";
import { statusColor, statusLabel } from "../theme";

export function StatusBar(props: {
  width: number;
  statuses: Record<AgentId, AgentStatus>;
}) {
  return (
    <Box width={props.width} paddingX={1}>
      {(["orchestrator", "frontend", "backend", "tester"] as AgentId[]).map((id, i) => (
        <Text key={id}>
          {i > 0 ? <Text color="gray">  </Text> : null}
          <Text color="gray">{AGENT_META[id].short}:</Text>
          <Text color={statusColor(props.statuses[id])}>
            {statusLabel(props.statuses[id])}
          </Text>
        </Text>
      ))}
    </Box>
  );
}
