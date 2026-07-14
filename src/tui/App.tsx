import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Box, Text, useApp, useInput, useStdout } from "ink";
import type {
  ArrowConfig,
  AgentId,
  TaskEnvelope,
  AgentLogLine,
  SessionPhase,
  PlanDoc,
  PlanQuestion,
  GoalState,
} from "../config/types";
import { AGENT_ORDER, AGENT_META, rootAgentOf, isMainAgent } from "../config/types";
import type { Harness } from "../core/harness";
import type { HarnessEvent } from "../core/events";
import type { SessionEvent } from "../core/session-log";
import { Header } from "./components/Header";
import { AgentPane, type AgentPaneModel } from "./components/AgentPane";
import { BusFeed } from "./components/BusFeed";
import { InputBar } from "./components/InputBar";
import { HelpOverlay } from "./components/HelpOverlay";
import { PhaseBar } from "./components/PhaseBar";
import { QuestionsPanel } from "./components/QuestionsPanel";
import {
  SettingsOverlay,
  configToSettings,
  type SettingsValues,
} from "./components/SettingsOverlay";
import { FileTree } from "./components/FileTree";
import { DiffPanel } from "./components/DiffPanel";
import { PlanPanel } from "./components/PlanPanel";
import { SwarmMap, type SwarmNode } from "./components/SwarmMap";
import { Timeline } from "./components/Timeline";
import { CommandHints } from "./components/CommandHints";
import { dispatchCommand, agentsInfo } from "../commands/registry";
import { saveSettings } from "../config/load";
import { listTemplates } from "../templates/catalog";

interface ApprovalState {
  id: string;
  agent: string;
  tool: string;
  preview: string;
}

type Overlay =
  | "none"
  | "help"
  | "settings"
  | "goal"
  | "agents"
  | "templates"
  | "plan"
  | "replay";

type LayoutMode = "dashboard" | "classic";

function emptyAgent(id: AgentId): AgentPaneModel {
  return {
    id,
    status: "idle",
    logs: [],
    todos: [],
    tokenIn: 0,
    tokenOut: 0,
    toolCalls: 0,
  };
}

export function App(props: {
  harness: Harness;
  config: ArrowConfig;
  initialPrompt?: string;
}) {
  const { harness } = props;
  const [config, setConfig] = useState(props.config);
  const { exit } = useApp();
  const { stdout } = useStdout();
  const [cols, setCols] = useState(stdout?.columns || 120);
  const [rows, setRows] = useState(stdout?.rows || 40);
  const [layoutMode, setLayoutMode] = useState<LayoutMode>("classic"); // Default is simple/classic chat interface!
  const [chatLines, setChatLines] = useState<{ id: string; sender: string; text: string; color?: string }[]>([
    { id: "welcome-1", sender: "system", text: "Welcome to ArrowCode Classic Mode!", color: "cyan" },
    { id: "welcome-2", sender: "system", text: "Type any prompt or /help to explore. Toggle layout with /layout.", color: "gray" },
  ]);
  const [agents, setAgents] = useState<Record<AgentId, AgentPaneModel>>(() => {
    const o = {} as Record<AgentId, AgentPaneModel>;
    for (const id of AGENT_ORDER) o[id] = emptyAgent(id);
    return o;
  });
  const [bus, setBus] = useState<TaskEnvelope[]>([]);
  const [runActive, setRunActive] = useState(false);
  const [yolo, setYolo] = useState(config.autoApprove);
  const [overlay, setOverlay] = useState<Overlay>("none");
  const [systemLine, setSystemLine] = useState(
    "Dashboard ready — /plan to start  |  Tab cycles file focus  |  /help",
  );
  const [approval, setApproval] = useState<ApprovalState | null>(null);
  const [finalText, setFinalText] = useState("");
  const [phase, setPhase] = useState<SessionPhase>("idle");
  const [plan, setPlan] = useState<PlanDoc | null>(null);
  const [questions, setQuestions] = useState<PlanQuestion[]>([]);
  const [goal, setGoal] = useState<GoalState | null>(harness.goal);
  const [cycle, setCycle] = useState(0);
  const [swarmActive, setSwarmActive] = useState(0);
  const [swarmNodes, setSwarmNodes] = useState<SwarmNode[]>([]);
  const [timeline, setTimeline] = useState<SessionEvent[]>([]);
  const [filePaths, setFilePaths] = useState<string[]>([]);
  const [selectedFile, setSelectedFile] = useState<string | undefined>();
  const [diffText, setDiffText] = useState("");
  const [fileFocus, setFileFocus] = useState(0);

  useEffect(() => {
    const onResize = () => {
      setCols(stdout?.columns || 120);
      setRows(stdout?.rows || 40);
    };
    stdout?.on?.("resize", onResize);
    return () => {
      stdout?.off?.("resize", onResize);
    };
  }, [stdout]);

  // Session timeline
  useEffect(() => {
    return harness.sessionLog.on((e) => {
      setTimeline((prev) => [...prev.slice(-200), e]);
    });
  }, [harness]);

  const refreshFiles = useCallback(() => {
    const paths = harness.files.uniquePaths(40);
    setFilePaths(paths);
    setSelectedFile((cur) => {
      const next = cur && paths.includes(cur) ? cur : paths[0];
      if (next) setDiffText(harness.files.diffFor(next));
      return next;
    });
  }, [harness]);

  const patchAgent = useCallback((id: AgentId, patch: Partial<AgentPaneModel>) => {
    setAgents((prev) => ({
      ...prev,
      [id]: { ...prev[id], ...patch },
    }));
  }, []);

  const appendLog = useCallback((id: AgentId, line: AgentLogLine) => {
    setAgents((prev) => {
      const cur = prev[id];
      const logs = [...cur.logs, line];
      const trimmed = logs.length > 400 ? logs.slice(-400) : logs;
      return { ...prev, [id]: { ...cur, logs: trimmed } };
    });
    if (line.kind !== "think") {
      setChatLines((prev) => [
        ...prev.slice(-100),
        {
          id: `log-${Date.now()}-${Math.random()}`,
          sender: id.toUpperCase(),
          text: line.text,
          color: id === "orchestrator" ? "cyan" : id === "frontend" ? "magenta" : id === "backend" ? "yellow" : "green",
        },
      ]);
    }
  }, []);

  useEffect(() => {
    const off = harness.events.on((e: HarnessEvent) => {
      switch (e.type) {
        case "agent_status": {
          const id = isMainAgent(String(e.agent))
            ? e.agent
            : rootAgentOf(String(e.agent));
          patchAgent(id as AgentId, {
            status: e.status,
            detail: isMainAgent(String(e.agent))
              ? e.detail
              : `[${e.agent}] ${e.detail || e.status}`,
            currentTool: e.status === "tool" ? e.detail : undefined,
          });
          break;
        }
        case "agent_log": {
          const id = isMainAgent(String(e.agent))
            ? e.agent
            : rootAgentOf(String(e.agent));
          const line = isMainAgent(String(e.agent))
            ? e.line
            : { ...e.line, text: `[${e.agent}] ${e.line.text}` };
          appendLog(id as AgentId, line);
          if (e.line.kind === "tool") {
            harness.sessionLog.push("tool", e.line.text.slice(0, 120), {
              agent: String(e.agent),
            });
          }
          break;
        }
        case "agent_tool": {
          const id = isMainAgent(String(e.agent))
            ? e.agent
            : rootAgentOf(String(e.agent));
          patchAgent(id as AgentId, {
            status: "tool",
            currentTool: `${e.name} ${e.detail}`,
            detail: e.detail,
          });
          harness.sessionLog.push("tool", `${e.name} ${e.detail}`, {
            agent: String(e.agent),
          });
          // refresh files shortly after write tools
          if (["write_file", "edit_file", "multi_edit", "delete_file", "move_file"].includes(e.name)) {
            setTimeout(refreshFiles, 50);
          }
          break;
        }
        case "agent_tokens": {
          if (isMainAgent(String(e.agent))) {
            patchAgent(e.agent as AgentId, {
              tokenIn: e.tokenIn,
              tokenOut: e.tokenOut,
              toolCalls: e.toolCalls,
            });
          }
          break;
        }
        case "agent_todos": {
          if (isMainAgent(String(e.agent))) {
            patchAgent(e.agent as AgentId, { todos: e.todos });
          }
          break;
        }
        case "bus":
          setBus((b) => [...b.slice(-80), e.message]);
          harness.sessionLog.push(
            "bus",
            `${e.message.from}→${e.message.to} ${e.message.title}`,
          );
          setChatLines((prev) => [
            ...prev.slice(-100),
            {
              id: `bus-${Date.now()}-${Math.random()}`,
              sender: "bus",
              text: `${e.message.from} -> ${e.message.to}: ${e.message.title}`,
              color: "gray",
            },
          ]);
          break;
        case "system":
          setSystemLine(e.text);
          harness.sessionLog.push("system", e.text);
          setChatLines((prev) => [
            ...prev.slice(-100),
            {
              id: `sys-${Date.now()}-${Math.random()}`,
              sender: "system",
              text: e.text,
              color: "yellow",
            },
          ]);
          break;
        case "run_start":
          setRunActive(true);
          setFinalText("");
          setSystemLine(`Running: ${e.prompt.slice(0, 80)}`);
          harness.sessionLog.push("user", e.prompt.slice(0, 200));
          break;
        case "run_end":
          setRunActive(false);
          refreshFiles();
          break;
        case "final":
          setFinalText(e.text);
          harness.sessionLog.push("final", e.text.slice(0, 200));
          setChatLines((prev) => [
            ...prev.slice(-100),
            {
              id: `final-${Date.now()}-${Math.random()}`,
              sender: "ready",
              text: e.text,
              color: "green",
            },
          ]);
          break;
        case "approval_request":
          setApproval({
            id: e.id,
            agent: String(e.agent),
            tool: e.tool,
            preview: e.argsPreview,
          });
          break;
        case "approval_resolved":
          setApproval((a) => (a && a.id === e.id ? null : a));
          break;
        case "phase":
          setPhase(e.phase);
          break;
        case "plan":
          setPlan(e.plan);
          break;
        case "questions":
          setQuestions(e.questions);
          break;
        case "goal":
          setGoal(e.goal);
          break;
        case "cycle":
          setCycle(e.n);
          break;
        case "swarm":
          setSwarmActive(e.active || 0);
          setSystemLine(
            `swarm ${e.action} ${e.workerId} (active ${e.active}/${e.total ?? config.swarm?.maxWorkers ?? 16}) ${e.role || ""}`,
          );
          harness.sessionLog.push("swarm", `${e.action} ${e.workerId}`, {
            detail: e.role,
          });
          // refresh node list from engine
          {
            const nodes: SwarmNode[] = harness.swarm.listWorkers().map((w) => ({
              id: w.id,
              role: w.role,
              status: w.status,
              depth: w.depth,
              parentId: String(w.parentId),
            }));
            setSwarmNodes(nodes);
          }
          break;
      }
    });
    return off;
  }, [harness, patchAgent, appendLog, refreshFiles, config.swarm?.maxWorkers]);

  useEffect(() => {
    if (props.initialPrompt) {
      void harness.startPlan(props.initialPrompt);
    }
  }, []);

  useInput((input, key) => {
    if (overlay === "settings") return;
    if (overlay !== "none" && (key.escape || input === "q")) {
      setOverlay("none");
      return;
    }
    if (key.tab && overlay === "none" && filePaths.length) {
      setFileFocus((i) => {
        const n = (i + 1) % filePaths.length;
        const p = filePaths[n];
        setSelectedFile(p);
        if (p) setDiffText(harness.files.diffFor(p));
        return n;
      });
      return;
    }
    if (approval) {
      if (input === "y" || input === "Y") {
        harness.resolveApproval(approval.id, true);
        setApproval(null);
      } else if (input === "n" || input === "N") {
        harness.resolveApproval(approval.id, false);
        setApproval(null);
      }
    }
  });

  const onSubmit = async (line: string) => {
    // Save to user chat log too
    setChatLines((prev) => [
      ...prev.slice(-100),
      {
        id: `user-${Date.now()}-${Math.random()}`,
        sender: "user",
        text: line,
        color: "white",
      },
    ]);

    if (line.startsWith("/")) {
      // local dashboard commands
      const [cmd, ...rest] = line.slice(1).split(/\s+/);
      const c = (cmd || "").toLowerCase();
      if (c === "replay") {
        const path = harness.exportReplay(rest[0]);
        setSystemLine(`Replay exported → ${path}`);
        setOverlay("replay");
        return;
      }
      if (c === "diff") {
        refreshFiles();
        setSystemLine("Files/diff refreshed");
        return;
      }
      if (c === "dashboard" || c === "dash") {
        refreshFiles();
        setSystemLine("Dashboard panels refreshed");
        return;
      }
      if (c === "layout" || c === "ui") {
        setLayoutMode((prev) => (prev === "dashboard" ? "classic" : "dashboard"));
        setSystemLine(`Layout switched to ${layoutMode === "dashboard" ? "classic" : "dashboard"}`);
        return;
      }

      const res = await dispatchCommand(line, {
        harness,
        setYolo,
        getYolo: () => yolo,
      });
      if (res.type === "exit") {
        exit();
        return;
      }
      if (res.type === "open_help") {
        setOverlay("help");
        return;
      }
      if (res.type === "open_settings") {
        setOverlay("settings");
        return;
      }
      if (res.type === "open_goal") {
        setOverlay("goal");
        return;
      }
      if (res.type === "open_agents") {
        setOverlay("agents");
        return;
      }
      if (res.type === "open_templates") {
        setOverlay("templates");
        return;
      }
      if (res.type === "open_plan") {
        setOverlay("plan");
        return;
      }
      if (res.type === "ok" && res.message) setSystemLine(res.message);
      if (res.type === "error") setSystemLine(res.message);
      setYolo(harness.config.autoApprove);
      setConfig({ ...harness.config });
      refreshFiles();
      return;
    }
    harness.chat(line);
  };

  const onSettingsSave = (v: SettingsValues) => {
    harness.setGoalText(v.goal, v.templateId || undefined);
    if (v.templateId) harness.applyTemplate(v.templateId);
    harness.updateConfig({
      provider: v.provider,
      model: v.model,
      baseUrl: v.baseUrl,
      temperature: v.temperature,
      maxTokens: v.maxTokens,
      maxToolRounds: v.maxToolRounds,
      maxExecuteCycles: v.maxExecuteCycles,
      autoApprove: v.autoApprove,
      systemExtra: v.systemExtra,
      agentsEnabled: v.agentsEnabled,
      templateId: v.templateId || undefined,
      goal: v.goal,
      swarm: {
        ...(harness.config.swarm || {
          maxDepth: 2,
          maxChildrenPerAgent: 4,
          summarizeThresholdChars: 100_000,
          keepRecentMessages: 14,
          maxWorkers: 16,
          enabled: true,
        }),
        maxWorkers: v.swarmMaxWorkers,
        enabled: v.swarmEnabled,
      },
    });
    saveSettings(harness.config);
    setYolo(v.autoApprove);
    setConfig({ ...harness.config });
    setOverlay("none");
    setSystemLine("Settings saved.");
  };

  // ---------- layout ----------
  const width = cols;
  const showQuestions =
    (phase === "questions" || phase === "planning") && questions.length > 0;
  const headerH = 3;
  const phaseH = 1;
  const hintsH = 1;
  const inputH = approval ? 7 : 3;
  const bottomH = 5; // bus + timeline row
  const qH = showQuestions ? 5 : 0;
  const footerH = finalText ? 3 : 1;
  const midH = Math.max(
    12,
    rows - headerH - phaseH - hintsH - inputH - bottomH - qH - footerH - 1,
  );

  // left: 2x2 agents (~58%), right: plan/swarm/files/diff (~42%)
  const leftW = Math.floor(width * 0.58);
  const rightW = width - leftW;
  const paneW = Math.floor(leftW / 2);
  const paneH = Math.floor(midH / 2);
  const rightTopH = Math.floor(midH / 2);
  const rightBotH = midH - rightTopH;
  const planW = Math.floor(rightW / 2);
  const swarmW = rightW - planW;
  const treeW = Math.floor(rightW * 0.42);
  const diffW = rightW - treeW;

  const busW = Math.floor(width * 0.55);
  const timeW = width - busW;

  const panes = useMemo(() => AGENT_ORDER.map((id) => agents[id]), [agents]);

  if (overlay === "settings") {
    return (
      <Box width={width} height={rows} alignItems="center" justifyContent="center">
        <SettingsOverlay
          width={width}
          height={rows}
          initial={configToSettings(config, goal?.text || config.goal || "")}
          onSave={onSettingsSave}
          onCancel={() => setOverlay("none")}
        />
      </Box>
    );
  }

  if (overlay === "help") {
    return (
      <Box
        width={width}
        height={rows}
        alignItems="center"
        justifyContent="center"
        flexDirection="column"
      >
        <HelpOverlay width={78} height={24} />
      </Box>
    );
  }

  if (overlay === "agents") {
    return (
      <Box
        flexDirection="column"
        borderStyle="double"
        borderColor="cyan"
        width={Math.min(width, 90)}
        height={Math.min(rows, 20)}
        paddingX={1}
        marginLeft={2}
        marginTop={2}
      >
        <Text color="cyan" bold>
          AGENT PERSONALITIES
        </Text>
        <Text color="gray">Edit ~/.arrowcode/agents/*.md (from defaults/ on install)</Text>
        <Text>{agentsInfo(harness)}</Text>
        <Text color="gray">esc to close</Text>
      </Box>
    );
  }

  if (overlay === "templates") {
    const tmpls = listTemplates();
    return (
      <Box
        flexDirection="column"
        borderStyle="double"
        borderColor="cyan"
        width={Math.min(width, 80)}
        height={Math.min(rows, 22)}
        paddingX={1}
        marginLeft={2}
        marginTop={2}
      >
        <Text color="cyan" bold>
          TEMPLATES
        </Text>
        <Text color="gray">Apply: /templates feature</Text>
        {tmpls.map((t) => (
          <Text key={t.id}>
            <Text color="yellow">{t.id.padEnd(12)}</Text>
            <Text color="white">{t.name}</Text>
            <Text color="gray"> — {t.description}</Text>
          </Text>
        ))}
        <Text color="gray">esc to close</Text>
      </Box>
    );
  }

  if (overlay === "goal") {
    return (
      <Box
        flexDirection="column"
        borderStyle="double"
        borderColor="cyan"
        width={Math.min(width, 80)}
        height={Math.min(rows, 18)}
        paddingX={1}
        marginLeft={2}
        marginTop={2}
      >
        <Text color="cyan" bold>
          ACTIVE GOAL
        </Text>
        <Text>{goal?.text || "(empty — set in /settings)"}</Text>
        {goal?.templateId ? (
          <Text color="gray">template: {goal.templateId}</Text>
        ) : null}
        {(goal?.checklist || []).map((c) => (
          <Text key={c.id} color={c.done ? "green" : "gray"}>
            [{c.done ? "x" : " "}] {c.text}
          </Text>
        ))}
        <Text color="gray">Edit via /settings  |  esc to close</Text>
      </Box>
    );
  }

  if (overlay === "replay") {
    const events = harness.sessionLog.list(30);
    return (
      <Box
        flexDirection="column"
        borderStyle="double"
        borderColor="green"
        width={Math.min(width, 90)}
        height={Math.min(rows, 24)}
        paddingX={1}
        marginLeft={2}
        marginTop={1}
      >
        <Text color="green" bold>
          SESSION REPLAY (recent)
        </Text>
        <Text color="gray">/replay exports full JSON to ~/.arrowcode/memory/replays/</Text>
        {events.map((e) => (
          <Text key={e.id} wrap="truncate">
            <Text color="gray">{new Date(e.ts).toISOString().slice(11, 19)} </Text>
            <Text color="cyan">{e.kind.padEnd(7)}</Text>
            <Text> {e.title}</Text>
          </Text>
        ))}
        <Text color="gray">esc to close</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" width={width} height={rows}>
      <Header
        config={config}
        runActive={runActive}
        width={width}
        yolo={yolo}
        swarmActive={swarmActive}
        swarmMax={config.swarm?.maxWorkers ?? 16}
      />
      <PhaseBar
        width={width}
        phase={phase}
        cycle={cycle}
        maxCycle={config.maxExecuteCycles || 12}
        planTitle={plan?.title}
        questions={questions}
      />

      {layoutMode === "dashboard" ? (
        /* MAIN DASHBOARD MODE */
        <Box flexDirection="row" height={midH}>
          {/* LEFT: 2x2 agents */}
          <Box flexDirection="column" width={leftW} height={midH}>
            <Box flexDirection="row" height={paneH}>
              <AgentPane model={panes[0]!} width={paneW} height={paneH} />
              <AgentPane model={panes[1]!} width={leftW - paneW} height={paneH} />
            </Box>
            <Box flexDirection="row" height={midH - paneH}>
              <AgentPane model={panes[2]!} width={paneW} height={midH - paneH} />
              <AgentPane
                model={panes[3]!}
                width={leftW - paneW}
                height={midH - paneH}
              />
            </Box>
          </Box>

          {/* RIGHT: plan | swarm / files | diff */}
          <Box flexDirection="column" width={rightW} height={midH}>
            <Box flexDirection="row" height={rightTopH}>
              <PlanPanel plan={plan} width={planW} height={rightTopH} />
              <SwarmMap
                width={swarmW}
                height={rightTopH}
                nodes={swarmNodes}
                maxWorkers={config.swarm?.maxWorkers ?? 16}
                active={swarmActive}
              />
            </Box>
            <Box flexDirection="row" height={rightBotH}>
              <FileTree
                width={treeW}
                height={rightBotH}
                paths={filePaths}
                selected={selectedFile}
              />
              <DiffPanel
                width={diffW}
                height={rightBotH}
                path={selectedFile}
                diff={diffText}
              />
            </Box>
          </Box>
        </Box>
      ) : (
        /* CLASSIC SIMPLE CHAT MODE */
        <Box flexDirection="row" height={midH}>
          {/* LEFT CHAT PANEL: Beautiful classic scrollable Chat stream */}
          <Box
            flexDirection="column"
            width={leftW}
            height={midH}
            borderStyle="single"
            borderColor="gray"
            paddingX={1}
          >
            <Box flexDirection="column" height={midH - 2}>
              {chatLines.slice(-Math.floor(midH / 2)).map((line) => (
                <Text key={line.id}>
                  <Text color={line.color || "white"} bold>
                    {`[${line.sender}]`}
                  </Text>
                  <Text color="white"> {line.text.slice(0, leftW - 12)}</Text>
                </Text>
              ))}
            </Box>
          </Box>

          {/* RIGHT SIDEBAR: Sleek classic high-contrast status card */}
          <Box
            flexDirection="column"
            width={rightW}
            height={midH}
            borderStyle="single"
            borderColor="cyan"
            paddingX={1}
          >
            <Text color="cyan" bold>┌── STATUS PANEL ──┐</Text>
            <Box flexDirection="column" marginTop={1}>
              <Text>
                <Text color="gray">Workspace: </Text>
                <Text color="white">{config.workspace.split("/").pop() || "root"}</Text>
              </Text>
              <Text>
                <Text color="gray">Provider:  </Text>
                <Text color="magenta">{config.provider}</Text>
              </Text>
              <Text>
                <Text color="gray">Active:    </Text>
                <Text color="yellow">{phase.toUpperCase()}</Text>
              </Text>
              <Text>
                <Text color="gray">Swarm:     </Text>
                <Text color="green">{`${swarmActive} / ${config.swarm?.maxWorkers ?? 16}`}</Text>
              </Text>
            </Box>

            <Box flexDirection="column" marginTop={1} borderStyle="single" borderColor="gray">
              <Text color="cyan" bold> SQUAD STATUS </Text>
              {panes.map((p) => (
                <Text key={p.id}>
                  <Text color="gray">{p.id.toUpperCase().slice(0, 4)}: </Text>
                  <Text color={p.status === "thinking" ? "yellow" : "green"}>
                    {p.status.toUpperCase()}
                  </Text>
                </Text>
              ))}
            </Box>

            <Box marginTop={1}>
              <Text color="gray" dimColor>
                Toggle UI mode with: /layout
              </Text>
            </Box>
          </Box>
        </Box>
      )}

      {showQuestions ? (
        <QuestionsPanel width={width} height={qH} questions={questions} />
      ) : null}

      {/* BOTTOM: bus + timeline */}
      <Box flexDirection="row" height={bottomH}>
        <BusFeed messages={bus} width={busW} height={bottomH} />
        <Timeline events={timeline} width={timeW} height={bottomH} />
      </Box>

      <Box paddingX={1} width={width}>
        <Text color="gray" wrap="truncate">
          {systemLine}
        </Text>
      </Box>

      {finalText ? (
        <Box
          borderStyle="single"
          borderColor="green"
          paddingX={1}
          width={width}
          height={2}
        >
          <Text wrap="truncate">
            {finalText.replace(/\s+/g, " ").slice(0, width * 2)}
          </Text>
        </Box>
      ) : null}

      <CommandHints width={width} phase={phase} />

      <InputBar
        width={width}
        onSubmit={(v) => void onSubmit(v)}
        approval={approval}
        onApprove={(id, yes) => {
          harness.resolveApproval(id, yes);
          setApproval(null);
        }}
        placeholder={
          phase === "questions"
            ? "answer questions (1. ... 2. ...)  |  /help"
            : phase === "await_confirm"
              ? "/confirm to execute  |  feedback to revise plan"
              : phase === "await_accept"
                ? "/accept  /reject  /stop  |  /replay"
                : "/plan  /settings  /dashboard  /replay  /help"
        }
      />
    </Box>
  );
}
