import React from "react";
import { Box, Text } from "ink";
import type { SessionPhase } from "../../config/types";

export function CommandHints(props: {
  width: number;
  phase: SessionPhase;
}) {
  const hint =
    props.phase === "questions"
      ? "answer 1. 2. …  |  /help"
      : props.phase === "await_confirm"
        ? "/confirm execute  |  feedback revises plan  |  /settings"
        : props.phase === "executing"
          ? "/swarm  /status  /stop  |  @fe @be @qa"
          : props.phase === "await_accept"
            ? "/accept  /reject  /stop  |  /replay"
            : "/plan  /settings  /templates  /help  |  tab focus panels";

  return (
    <Box width={props.width} paddingX={1}>
      <Text color="gray" dimColor wrap="truncate">
        {hint}
      </Text>
    </Box>
  );
}
