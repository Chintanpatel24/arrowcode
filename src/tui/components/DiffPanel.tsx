import React from "react";
import { Box, Text } from "ink";

export function DiffPanel(props: {
  width: number;
  height: number;
  path?: string;
  diff: string;
}) {
  const { width, height, path, diff } = props;
  const lines = (diff || "(select a file)").split("\n").slice(0, Math.max(2, height - 3));
  return (
    <Box
      flexDirection="column"
      borderStyle="single"
      borderColor="magenta"
      width={width}
      height={height}
      paddingX={1}
    >
      <Text color="magenta" bold>
        DIFF {path ? `· ${path.slice(0, Math.max(10, width - 12))}` : ""}
      </Text>
      {lines.map((l, i) => {
        let color: string | undefined;
        if (l.startsWith("+") && !l.startsWith("+++")) color = "green";
        else if (l.startsWith("-") && !l.startsWith("---")) color = "red";
        else if (l.startsWith("@@")) color = "cyan";
        else color = "gray";
        return (
          <Text key={i} color={color} wrap="truncate">
            {l.slice(0, Math.max(10, width - 4))}
          </Text>
        );
      })}
    </Box>
  );
}
