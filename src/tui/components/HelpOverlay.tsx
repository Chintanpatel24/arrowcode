import React from "react";
import { Box, Text } from "ink";
import { listCommands } from "../../commands/registry";

export function HelpOverlay(props: { width: number; height: number }) {
  const cmds = listCommands();
  return (
    <Box
      flexDirection="column"
      borderStyle="double"
      borderColor="cyan"
      width={Math.min(props.width, 78)}
      height={Math.min(props.height, 24)}
      paddingX={1}
    >
      <Text color="cyan" bold>
        ARROWCODE COMMANDS
      </Text>
      <Text color="gray">------------------</Text>
      {cmds.map((c) => (
        <Text key={c.cmd}>
          <Text color="white">{c.cmd.padEnd(18)}</Text>
          <Text color="gray">{c.help}</Text>
        </Text>
      ))}
      <Text> </Text>
      <Text color="cyan" bold>
        FLOW
      </Text>
      <Text color="gray">
        /plan -&gt; questions -&gt; /confirm -&gt; execute (swarm) -&gt; /accept
      </Text>
      <Text color="gray">
        Dashboard: agents | plan | swarm | files | diff | bus | timeline
      </Text>
      <Text color="gray">Tab cycles touched files · /replay exports session</Text>
      <Text color="gray">
        Personalities: ~/.arrowcode/agents/*.md (from defaults/ on install)
      </Text>
      <Text color="gray">Route: @orch @fe @be @qa @all</Text>
      <Text color="gray">press esc to close</Text>
    </Box>
  );
}
