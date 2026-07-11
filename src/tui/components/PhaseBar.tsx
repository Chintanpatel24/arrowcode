import React from "react";
import { Box, Text } from "ink";
import type { SessionPhase, PlanQuestion } from "../../config/types";

export function PhaseBar(props: {
  width: number;
  phase: SessionPhase;
  cycle: number;
  maxCycle: number;
  planTitle?: string;
  questions?: PlanQuestion[];
}) {
  const { phase, cycle, maxCycle, planTitle, questions } = props;
  const openQ = (questions || []).filter((q) => !q.answer).length;
  const color =
    phase === "executing"
      ? "cyan"
      : phase === "await_confirm"
        ? "yellow"
        : phase === "await_accept"
          ? "green"
          : phase === "questions" || phase === "planning"
            ? "magenta"
            : phase === "accepted"
              ? "green"
              : phase === "stopped"
                ? "red"
                : "gray";

  return (
    <Box width={props.width} paddingX={1} justifyContent="space-between">
      <Text>
        <Text color="gray">phase </Text>
        <Text color={color} bold>
          {phase.toUpperCase()}
        </Text>
        {phase === "executing" ? (
          <Text color="gray">
            {" "}
            cycle {cycle}/{maxCycle}
          </Text>
        ) : null}
        {planTitle ? (
          <Text color="gray">
            {" "}
            | plan {truncate(planTitle, 28)}
          </Text>
        ) : null}
      </Text>
      <Text color="gray">
        {phase === "questions"
          ? `${openQ} open question(s) — answer then wait for plan`
          : phase === "await_confirm"
            ? "/confirm to execute"
            : phase === "await_accept"
              ? "/accept  /reject  /stop"
              : phase === "planning"
                ? "planning…"
                : "/plan  /settings  /help"}
      </Text>
    </Box>
  );
}

function truncate(s: string, n: number) {
  return s.length <= n ? s : s.slice(0, n - 1) + "~";
}
