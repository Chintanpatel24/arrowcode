import React from "react";
import { Box, Text } from "ink";

export function FileTree(props: {
  width: number;
  height: number;
  paths: string[];
  selected?: string;
  title?: string;
}) {
  const { paths, width, height, selected } = props;
  const bodyH = Math.max(2, height - 2);
  const shown = paths.slice(0, bodyH);
  return (
    <Box
      flexDirection="column"
      borderStyle="single"
      borderColor="gray"
      width={width}
      height={height}
      paddingX={1}
    >
      <Text color="cyan" bold>
        {props.title || "FILES"}
      </Text>
      {shown.length === 0 ? (
        <Text color="gray" dimColor>
          no files touched yet
        </Text>
      ) : (
        shown.map((p) => (
          <Text
            key={p}
            color={p === selected ? "yellow" : "white"}
            wrap="truncate"
          >
            {p === selected ? "> " : "  "}
            {p.slice(0, Math.max(8, width - 6))}
          </Text>
        ))
      )}
    </Box>
  );
}
