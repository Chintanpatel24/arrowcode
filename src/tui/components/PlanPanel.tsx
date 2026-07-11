import React from "react";
import { Box, Text } from "ink";
import type { PlanDoc } from "../../config/types";

export function PlanPanel(props: {
  width: number;
  height: number;
  plan: PlanDoc | null;
}) {
  const { plan, width, height } = props;
  const lines: string[] = [];
  if (!plan) {
    lines.push("no plan yet — /plan");
  } else {
    lines.push(plan.title);
    lines.push(plan.summary.slice(0, 120));
    lines.push("steps:");
    plan.steps.slice(0, 6).forEach((s, i) => lines.push(` ${i + 1}. ${s}`));
    if (plan.acceptance?.length) {
      lines.push("accept:");
      plan.acceptance.slice(0, 3).forEach((a) => lines.push(` - ${a}`));
    }
  }
  const shown = lines.slice(0, Math.max(2, height - 2));
  return (
    <Box
      flexDirection="column"
      borderStyle="single"
      borderColor="yellow"
      width={width}
      height={height}
      paddingX={1}
    >
      <Text color="yellow" bold>
        PLAN
      </Text>
      {shown.map((l, i) => (
        <Text key={i} wrap="truncate" color={i === 0 && plan ? "white" : "gray"}>
          {l.slice(0, Math.max(10, width - 4))}
        </Text>
      ))}
    </Box>
  );
}
