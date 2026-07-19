import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import TextInput from "ink-text-input";

const SUGGESTED_COMMANDS = [
  "/plan",
  "/swarm",
  "/confirm",
  "/accept",
  "/reject",
  "/stop",
  "/help",
  "/exit",
  "/add",
  "/settings",
  "/status",
  "/cost",
  "/clear",
  "/goal",
  ".plan",
  ".swarm",
  ".confirm",
  ".accept"
];

function getSuggestion(val: string): string {
  if (!val) return "";
  const lowercaseVal = val.toLowerCase();
  const match = SUGGESTED_COMMANDS.find((cmd) => cmd.toLowerCase().startsWith(lowercaseVal) && cmd.toLowerCase() !== lowercaseVal);
  return match ? match.slice(val.length) : "";
}

export function InputBar(props: {
  width: number;
  disabled?: boolean;
  placeholder?: string;
  onSubmit: (value: string) => void;
  approval?: { id: string; agent: string; tool: string; preview: string } | null;
  onApprove?: (id: string, yes: boolean) => void;
}) {
  const [value, setValue] = useState("");
  const { approval } = props;

  const suggestion = getSuggestion(value);

  useInput((input, key) => {
    if (!props.disabled && !approval) {
      if (key.tab || key.rightArrow) {
        if (suggestion) {
          setValue((v) => v + suggestion);
        }
      }
    }
  });

  if (approval) {
    return (
      <Box
        flexDirection="column"
        borderStyle="single"
        borderColor="yellow"
        width={props.width}
        paddingX={1}
      >
        <Text color="yellow" bold>
          APPROVAL REQUIRED
        </Text>
        <Text>
          <Text color="cyan">{approval.agent}</Text>
          <Text color="gray"> wants </Text>
          <Text color="yellow">{approval.tool}</Text>
        </Text>
        <Text color="gray" wrap="truncate">
          {approval.preview}
        </Text>
        <Text>
          <Text color="green">[y]</Text>
          <Text color="gray"> allow   </Text>
          <Text color="red">[n]</Text>
          <Text color="gray"> deny   </Text>
          <Text color="gray">or type y/n + enter</Text>
        </Text>
        <Box>
          <Text color="yellow" bold>
            {"? "}
          </Text>
          <TextInput
            value={value}
            onChange={setValue}
            onSubmit={(v) => {
              const t = v.trim().toLowerCase();
              if (t === "y" || t === "yes") {
                props.onApprove?.(approval.id, true);
                setValue("");
              } else if (t === "n" || t === "no") {
                props.onApprove?.(approval.id, false);
                setValue("");
              } else {
                setValue("");
              }
            }}
            placeholder="y / n"
          />
        </Box>
      </Box>
    );
  }

  return (
    <Box
      flexDirection="row"
      borderStyle="double"
      borderColor="cyan"
      width={props.width}
      paddingX={1}
    >
      <Text color="cyan" bold>
        {"prompt> "}
      </Text>
      <Box flexDirection="row" flexGrow={1}>
        <TextInput
          value={value}
          onChange={setValue}
          onSubmit={(v) => {
            const t = v.trim();
            if (!t) return;
            props.onSubmit(t);
            setValue("");
          }}
          placeholder={
            props.placeholder ||
            "describe a task  |  /help  /yolo  /exit  @fe @be @qa @orch"
          }
          focus={!props.disabled}
        />
        {suggestion ? (
          <Text color="gray" dimColor>
            {suggestion}
          </Text>
        ) : null}
      </Box>
    </Box>
  );
}
