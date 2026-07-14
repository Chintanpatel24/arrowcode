import React from "react";
import { Box, Text } from "ink";
import type { ArrowConfig } from "../../config/types";

export function Header(props: {
  config: ArrowConfig;
  runActive: boolean;
  width: number;
  yolo: boolean;
  swarmActive?: number;
  swarmMax?: number;
}) {
  const { config, runActive, yolo } = props;
  const sw =
    props.swarmActive != null
      ? ` swarm ${props.swarmActive}/${props.swarmMax ?? 16}`
      : "";
  return (
    <Box
      flexDirection="row"
      justifyContent="space-between"
      borderStyle="double"
      borderColor="cyan"
      paddingX={1}
      width={props.width}
    >
      <Box>
        <Text color="cyan" bold>
          {"◆ ARROWCODE ◆"}
        </Text>
        <Text color="gray"> [v1.0.0] </Text>
        <Text color="gray">| </Text>
        <Text color="white" bold>{config.provider.toUpperCase()}</Text>
        <Text color="gray"> / </Text>
        <Text color="magenta">{truncate(config.model, 28)}</Text>
        {config.templateId ? (
          <Text color="gray">
            {" "}
            | tmpl: {config.templateId}
          </Text>
        ) : null}
      </Box>
      <Box>
        <Text color="gray">ws </Text>
        <Text>{truncate(config.workspace, 22)}</Text>
        {sw ? <Text color="gray">{sw}</Text> : null}
        <Text color="gray"> | </Text>
        {yolo ? (
          <Text color="yellow" bold>
            YOLO
          </Text>
        ) : (
          <Text color="gray">approve</Text>
        )}
        <Text color="gray"> | </Text>
        {runActive ? (
          <Text color="cyan" bold>
            RUNNING
          </Text>
        ) : (
          <Text color="gray">ready</Text>
        )}
      </Box>
    </Box>
  );
}

function truncate(s: string, n: number) {
  if (s.length <= n) return s;
  return "..." + s.slice(-(n - 3));
}
