# Architecture

## System overview

```mermaid
flowchart TB
  subgraph UserInterface
    TUI[Dashboard TUI]
    CLI[CLI / headless]
  end

  subgraph HarnessCore[Harness]
    Phase[Phase machine]
    Policy[Security policy]
    Metrics[Metrics]
    Sessions[SessionManager]
    Checkpoints[Checkpoints / undo]
    Files[File tracker]
  end

  subgraph Agents
    ORCH[Orchestrator]
    FE[Frontend]
    BE[Backend]
    QA[Tester]
    SW[Swarm workers]
  end

  subgraph IO
    Bus[Message bus]
    Tools[Tool layer]
    LLM[LLM endpoints]
    WS[Workspace sandbox]
  end

  TUI --> HarnessCore
  CLI --> HarnessCore
  Phase --> ORCH
  Phase --> FE
  Phase --> BE
  Phase --> QA
  ORCH --> Bus
  FE --> Bus
  BE --> Bus
  QA --> Bus
  ORCH --> SW
  FE --> SW
  BE --> SW
  QA --> SW
  Agents --> Tools
  SW --> Tools
  Tools --> WS
  Agents --> LLM
  SW --> LLM
  Policy --> Tools
  Sessions --> Agents
  Checkpoints --> WS
  Files --> TUI
```

## Phase machine

```mermaid
stateDiagram-v2
  [*] --> idle
  idle --> planning: /plan or task
  planning --> questions: arrow-questions
  planning --> await_confirm: arrow-plan
  questions --> questions: user answers
  questions --> await_confirm: arrow-plan
  await_confirm --> executing: /confirm
  await_confirm --> await_confirm: plan feedback
  executing --> executing: cycles / swarm
  executing --> await_accept: arrow-ready
  await_accept --> executing: /reject
  await_accept --> accepted: /accept
  executing --> stopped: /stop
  accepted --> planning: new /plan
  stopped --> planning: new /plan
```

## Session + context layers

```mermaid
flowchart LR
  subgraph Durable["Durable (session)"]
    SM[Session meta]
    MEM[memory.md / decisions / files]
    PLAN[plan.json]
  end

  subgraph Hot["Hot (in RAM)"]
    MSG[Agent message window]
    TOOL[Tool results]
  end

  subgraph Injected["Each LLM turn"]
    L0[L0 System + personality]
    L1[L1 Project ARROW.md]
    L2[L2 Goal + Plan]
    L3[L3 Session memory]
    L4[L4 Hot window trimmed]
    L5[L5 Live tools]
  end

  SM --> L3
  MEM --> L3
  PLAN --> L2
  MSG --> L4
  TOOL --> L5
  L0 --> LLM
  L1 --> LLM
  L2 --> LLM
  L3 --> LLM
  L4 --> LLM
  L5 --> LLM
```

### How session memory works

| Store | Path | Purpose |
|-------|------|---------|
| Session index | `<workspace>/.arrowcode-sessions/index.json` | List / pick sessions |
| Meta | `.../<id>/meta.json` | phase, tokens, status, goal ref |
| Memory | `.../<id>/memory.json` + `memory.md` | decisions, notes, files, summary |
| Events | `.../<id>/events.jsonl` | append-only timeline |
| Plan | `.../<id>/plan.json` | last confirmed/draft plan |
| Digests | `.../<id>/digests.json` | per-agent compact resumes |

**Commands:** `/session new` · `/session list` · `/session load <id>` · `/session save` · `/session memory [note]` · `/session delete <id>`

**Context policy**

1. Durable session memory is re-injected every turn (L3).  
2. Hot window (L4) is summarized when large → summary written into session memory.  
3. Hot window is trimmed to `contextBudgetChars` with tool-pair sanitization.  
4. No global `~/.arrowcode` required for sessions (workspace-local).

## Swarm

```mermaid
flowchart TB
  ORCH[ORCH depth0]
  FE[FE depth0]
  BE[BE depth0]
  QA[QA depth0]
  FE1[fe.form1 depth1]
  FE2[fe.style2 depth1]
  BE1[be.auth1 depth1]
  H1[be.auth1.helper depth2]

  ORCH -->|message_agent| FE
  ORCH -->|message_agent| BE
  ORCH -->|message_agent| QA
  FE -->|spawn_worker| FE1
  FE -->|spawn_worker| FE2
  BE -->|spawn_worker| BE1
  BE1 -->|spawn_worker| H1
  FE1 -->|report| FE
  BE1 -->|report| BE
```

Caps: maxWorkers=16 · maxDepth=2 · maxChildrenPerAgent=4

## Security policy pipeline

```mermaid
flowchart TD
  Call[Tool call] --> Budget{Token budget?}
  Budget -->|exceeded| Deny1[Deny]
  Budget -->|ok| Dry{Dry-run?}
  Dry -->|write/bash| Deny2[Deny unless allowlisted bash]
  Dry -->|ok| Path{Sensitive path?}
  Path -->|yes| Deny3[Deny .env/keys]
  Path -->|no| Sec{Secret scan on content?}
  Sec -->|hit| Deny4[Deny]
  Sec -->|ok| AllowL{Bash allowlist?}
  AllowL -->|match| Auto[Auto-approve]
  AllowL -->|no| YOLO{YOLO?}
  YOLO -->|yes| Run[Execute]
  YOLO -->|no| Ask[User approval]
  Auto --> Run
  Ask -->|y| Run
  Ask -->|n| Deny5[Deny]
```

## Tool surface

```mermaid
mindmap
  root((Tools))
    Files
      read_file
      write_file
      edit_file
      multi_edit
      delete_file
      move_file
      list_dir
      tree
    Search
      glob
      grep
      search_files
      find_symbol
    Shell
      bash
      git_status
      diff_workspace
      diagnostics
    Swarm
      message_agent
      spawn_worker
      swarm_status
      todo_write
      think
    Other
      web_fetch
      notebook_read
      memory_append
      memory_read
```

## Layers (code)

| Layer | Path | Role |
|-------|------|------|
| TUI | `src/tui` | Dashboard |
| Harness | `src/core/harness.ts` | Phase + orchestration |
| Sessions | `src/session/manager.ts` | Durable session memory |
| Policy | `src/core/policy.ts` | Security gates |
| Checkpoints | `src/core/checkpoints.ts` | Undo |
| Swarm | `src/swarm` | Workers |
| Agents | `src/agents` | Tool loops |
| Tools | `src/tools` | Sandboxed IO |
| Bootstrap | `src/bootstrap` | defaults → optional ~/.arrowcode |
| Perf | `src/perf` | caches, parallel tools, fast context, timers |
| Sessions | `src/session` | durable workspace sessions |

## Lightning path

```mermaid
flowchart LR
  Turn[Agent turn] --> Cache{Prompt cache hit?}
  Cache -->|yes| LLM
  Cache -->|no| Build[Build system prompt]
  Build --> LLM[LLM]
  LLM --> Tools{Tool calls}
  Tools -->|read-only batch| Par[Parallel pool x8]
  Tools -->|writes/bash| Seq[Sequential + checkpoint]
  Par --> Ctx[Fast context trim]
  Seq --> Ctx
  Ctx --> Turn
```

## Packaged defaults vs user home

```mermaid
flowchart LR
  Repo[defaults/ in git] -->|install / --init / --setup| Home["~/.arrowcode optional"]
  Repo -->|runtime if no home| Agents[Agent prompts]
  Home -->|overrides| Agents
```
