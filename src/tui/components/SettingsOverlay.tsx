/**
 * Fullscreen settings window.
 * Sections: Goal | Model | Agents | Loop | Extra
 * Esc saves & closes. Tab cycles sections. Enter edits fields.
 */

import React, { useMemo, useState } from "react";
import { Box, Text, useInput } from "ink";
import TextInput from "ink-text-input";
import type { AgentId, ArrowConfig, ProviderId } from "../../config/types";
import { AGENT_ORDER, AGENT_META, NIM_MODELS } from "../../config/types";
import { listTemplates } from "../../templates/catalog";
import { listAgentPersonalityPaths } from "../../agents/personalities";

export interface SettingsValues {
  goal: string;
  templateId: string;
  provider: ProviderId;
  model: string;
  baseUrl: string;
  temperature: number;
  maxTokens: number;
  maxToolRounds: number;
  maxExecuteCycles: number;
  autoApprove: boolean;
  systemExtra: string;
  agentsEnabled: Record<AgentId, boolean>;
  swarmMaxWorkers: number;
  swarmEnabled: boolean;
}

type Section = "goal" | "model" | "agents" | "loop" | "extra";

const SECTIONS: Section[] = ["goal", "model", "agents", "loop", "extra"];

export function SettingsOverlay(props: {
  width: number;
  height: number;
  initial: SettingsValues;
  onSave: (v: SettingsValues) => void;
  onCancel: () => void;
}) {
  const [sectionIdx, setSectionIdx] = useState(0);
  const [values, setValues] = useState<SettingsValues>(props.initial);
  const [fieldIdx, setFieldIdx] = useState(0);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const section = SECTIONS[sectionIdx]!;

  const templates = useMemo(() => listTemplates(), []);
  const agentPaths = useMemo(() => listAgentPersonalityPaths(), []);

  const fields = useMemo(() => {
    switch (section) {
      case "goal":
        return [
          { key: "goal", label: "Goal text", value: values.goal },
          {
            key: "templateId",
            label: "Template id",
            value: values.templateId || "(none)",
          },
        ];
      case "model":
        return [
          { key: "provider", label: "Provider", value: values.provider },
          { key: "model", label: "Model", value: values.model },
          { key: "baseUrl", label: "Base URL", value: values.baseUrl },
          {
            key: "temperature",
            label: "Temperature",
            value: String(values.temperature),
          },
        ];
      case "agents":
        return AGENT_ORDER.map((id) => ({
          key: `agent:${id}`,
          label: `${AGENT_META[id].short} enabled`,
          value: values.agentsEnabled[id] ? "ON" : "OFF",
        }));
      case "loop":
        return [
          {
            key: "autoApprove",
            label: "YOLO auto-approve",
            value: values.autoApprove ? "ON" : "OFF",
          },
          {
            key: "maxToolRounds",
            label: "Max tool rounds / turn",
            value: String(values.maxToolRounds),
          },
          {
            key: "maxExecuteCycles",
            label: "Max execute cycles",
            value: String(values.maxExecuteCycles),
          },
          {
            key: "maxTokens",
            label: "Max tokens",
            value: String(values.maxTokens),
          },
          {
            key: "swarmMaxWorkers",
            label: "Swarm max workers",
            value: String(values.swarmMaxWorkers),
          },
          {
            key: "swarmEnabled",
            label: "Swarm enabled",
            value: values.swarmEnabled ? "ON" : "OFF",
          },
        ];
      case "extra":
        return [
          {
            key: "systemExtra",
            label: "Extra instructions",
            value: values.systemExtra || "(empty)",
          },
        ];
    }
  }, [section, values]);

  useInput((input, key) => {
    if (editing) return;
    if (key.escape) {
      props.onSave(values);
      return;
    }
    if (key.tab) {
      setSectionIdx((i) => (i + (key.shift ? SECTIONS.length - 1 : 1)) % SECTIONS.length);
      setFieldIdx(0);
      return;
    }
    if (key.upArrow) {
      setFieldIdx((i) => Math.max(0, i - 1));
      return;
    }
    if (key.downArrow) {
      setFieldIdx((i) => Math.min(fields.length - 1, i + 1));
      return;
    }
    if (input === "s" && key.ctrl) {
      props.onSave(values);
      return;
    }
    if (key.return) {
      const f = fields[fieldIdx];
      if (!f) return;
      // toggles
      if (f.key === "autoApprove") {
        setValues((v) => ({ ...v, autoApprove: !v.autoApprove }));
        return;
      }
      if (f.key === "swarmEnabled") {
        setValues((v) => ({ ...v, swarmEnabled: !v.swarmEnabled }));
        return;
      }
      if (f.key.startsWith("agent:")) {
        const id = f.key.slice(6) as AgentId;
        setValues((v) => ({
          ...v,
          agentsEnabled: {
            ...v.agentsEnabled,
            [id]: !v.agentsEnabled[id],
          },
        }));
        return;
      }
      // start edit
      setDraft(
        f.key === "goal"
          ? values.goal
          : f.key === "templateId"
            ? values.templateId
            : f.key === "provider"
              ? values.provider
              : f.key === "model"
                ? values.model
                : f.key === "baseUrl"
                  ? values.baseUrl
                  : f.key === "temperature"
                    ? String(values.temperature)
                    : f.key === "maxToolRounds"
                      ? String(values.maxToolRounds)
                      : f.key === "maxExecuteCycles"
                        ? String(values.maxExecuteCycles)
                        : f.key === "maxTokens"
                          ? String(values.maxTokens)
                          : f.key === "swarmMaxWorkers"
                            ? String(values.swarmMaxWorkers)
                          : f.key === "systemExtra"
                            ? values.systemExtra
                            : "",
      );
      setEditing(true);
    }
  });

  const applyDraft = () => {
    const f = fields[fieldIdx];
    if (!f) {
      setEditing(false);
      return;
    }
    setValues((v) => {
      const next = { ...v };
      switch (f.key) {
        case "goal":
          next.goal = draft;
          break;
        case "templateId":
          next.templateId = draft.trim();
          break;
        case "provider":
          next.provider = draft.trim() as ProviderId;
          break;
        case "model":
          next.model = draft.trim();
          break;
        case "baseUrl":
          next.baseUrl = draft.trim();
          break;
        case "temperature":
          next.temperature = Number(draft) || 0.2;
          break;
        case "maxToolRounds":
          next.maxToolRounds = Number(draft) || 30;
          break;
        case "maxExecuteCycles":
          next.maxExecuteCycles = Number(draft) || 12;
          break;
        case "maxTokens":
          next.maxTokens = Number(draft) || 8192;
          break;
        case "swarmMaxWorkers":
          next.swarmMaxWorkers = Math.max(1, Math.min(32, Number(draft) || 16));
          break;
        case "systemExtra":
          next.systemExtra = draft;
          break;
      }
      return next;
    });
    setEditing(false);
  };

  const w = Math.min(props.width, 88);
  const h = Math.min(props.height, 28);

  return (
    <Box
      flexDirection="column"
      borderStyle="double"
      borderColor="cyan"
      width={w}
      height={h}
      paddingX={1}
    >
      <Box justifyContent="space-between">
        <Text color="cyan" bold>
          SETTINGS
        </Text>
        <Text color="gray">Tab section  Enter edit/toggle  Esc save+close</Text>
      </Box>

      <Box marginTop={0}>
        {SECTIONS.map((s, i) => (
          <Text key={s}>
            <Text color={i === sectionIdx ? "cyan" : "gray"} bold={i === sectionIdx}>
              {`[${s}]`}
            </Text>
            <Text> </Text>
          </Text>
        ))}
      </Box>

      <Box flexDirection="column" marginTop={1} height={h - 8}>
        {fields.map((f, i) => (
          <Box key={f.key}>
            <Text color={i === fieldIdx ? "white" : "gray"}>
              {i === fieldIdx ? "> " : "  "}
              {f.label}:{" "}
            </Text>
            {editing && i === fieldIdx ? (
              <TextInput
                value={draft}
                onChange={setDraft}
                onSubmit={applyDraft}
                focus
              />
            ) : (
              <Text color={i === fieldIdx ? "yellow" : "white"}>
                {truncate(f.value, w - f.label.length - 8)}
              </Text>
            )}
          </Box>
        ))}

        {section === "goal" ? (
          <Box flexDirection="column" marginTop={1}>
            <Text color="gray">Templates: {templates.map((t) => t.id).join(", ")}</Text>
          </Box>
        ) : null}

        {section === "model" ? (
          <Box flexDirection="column" marginTop={1}>
            <Text color="gray">NIM models: {NIM_MODELS.slice(0, 3).join(" | ")}…</Text>
          </Box>
        ) : null}

        {section === "agents" ? (
          <Box flexDirection="column" marginTop={1}>
            <Text color="gray">Personality files (edit in your editor):</Text>
            {AGENT_ORDER.map((id) => (
              <Text key={id} color="gray">
                {"  "}
                {agentPaths[id]}
              </Text>
            ))}
          </Box>
        ) : null}
      </Box>

      <Text color="gray">
        Esc saves goal + settings to ~/.arrowcode and returns to the agent grid.
      </Text>
    </Box>
  );
}

export function configToSettings(cfg: ArrowConfig, goalText: string): SettingsValues {
  return {
    goal: goalText || cfg.goal || "",
    templateId: cfg.templateId || "",
    provider: cfg.provider,
    model: cfg.model,
    baseUrl: cfg.baseUrl,
    temperature: cfg.temperature,
    maxTokens: cfg.maxTokens,
    maxToolRounds: cfg.maxToolRounds,
    maxExecuteCycles: cfg.maxExecuteCycles || 12,
    autoApprove: cfg.autoApprove,
    systemExtra: cfg.systemExtra || "",
    agentsEnabled: {
      orchestrator: cfg.agentsEnabled?.orchestrator !== false,
      frontend: cfg.agentsEnabled?.frontend !== false,
      backend: cfg.agentsEnabled?.backend !== false,
      tester: cfg.agentsEnabled?.tester !== false,
    },
    swarmMaxWorkers: cfg.swarm?.maxWorkers ?? 16,
    swarmEnabled: cfg.swarm?.enabled !== false,
  };
}

function truncate(s: string, n: number) {
  const t = s.replace(/\s+/g, " ");
  return t.length <= n ? t : t.slice(0, Math.max(0, n - 1)) + "~";
}
