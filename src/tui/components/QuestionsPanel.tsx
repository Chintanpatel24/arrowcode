import React from "react";
import { Box, Text } from "ink";
import type { PlanQuestion } from "../../config/types";

export function QuestionsPanel(props: {
  width: number;
  height: number;
  questions: PlanQuestion[];
}) {
  const { questions, width, height } = props;
  if (!questions.length) return null;
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
        CLARIFYING QUESTIONS
      </Text>
      <Text color="gray">Answer with 1. ... 2. ... or free text for the next open item</Text>
      {questions.slice(0, Math.max(1, height - 3)).map((q, i) => (
        <Text key={q.id} wrap="truncate">
          <Text color={q.answer ? "green" : "yellow"}>
            {i + 1}.
          </Text>{" "}
          <Text>{q.question}</Text>
          {q.answer ? <Text color="gray"> → {q.answer}</Text> : null}
        </Text>
      ))}
    </Box>
  );
}
