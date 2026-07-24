# How to Use ArrowCode

Welcome to **ArrowCode**, a premium, high-performance multi-agent terminal coding harness. ArrowCode cleanly overtakes your terminal screen, offering an immersive, glitch-free interactive development environment tailored to modern engineering workflows.

---

## Immersive Control Loop

When you open ArrowCode, it takes over the terminal window, hiding standard shell scrollback history to keep your focus perfectly locked. On exiting, your previous shell canvas is fully restored.

1. **The Startup Screen**:
   - Offers cursor-based navigation (Arrow keys + Enter) to start a new worktree, resume a session, view history, or quit.
   - Includes standard system shortcuts:
     - `ctrl+w`: Start a new session / worktree.
     - `ctrl+s`: Resume your previous session.
     - `ctrl+q`: Gracefully quit the application and restore terminal.

2. **Core Operational Loop**:
   - **`/plan [goal]`**: Start drafting an execution strategy for your target task.
   - **Clarifying Questions**: ArrowCode's Orchestrator raises questions to eliminate ambiguity before touching any code.
   - **`/confirm`**: Approves the compiled plan and kicks off parallel execution across main agents & spawnable worker swarms.
   - **`/accept`**: Finalizes the changes, persists the session state, and cleanly logs out.

---

## Commands Catalog

| Command | Action / Explanation |
|---|---|
| `/help` | View help details and interactive command overlays. |
| `/plan [goal]` | Kick off the planning phase for a feature or bugfix. |
| `/confirm` | Approve the plan and begin automatic code construction and tests. |
| `/accept` | Conclude and save the session successfully. |
| `/reject [note]` | Decline the proposed changes and ask the agents to refine the result. |
| `/stop` | Freeze all currently running background execution runs immediately. |
| `/undo` | Walk back to the previous workspace checkpoint safely. |
| `/yolo` | Toggle automatic execution approval for all file edits and bash tools. |
| `/settings` | Open the full-screen terminal configuration dashboard. |
| `/exit` | Exit ArrowCode and cleanly restore your standard shell history. |

---

## Layout Modes

ArrowCode supports two beautiful premium layout experiences:
- **Classic Mode (Default)**: A clean minimalist chat pane showing elegant streaming conversation with a low-noise single-line status representing active agents (**ORCH**, **FE**, **BE**, **QA**).
- **Dashboard Mode**: An advanced 2x2 terminal overlay showing live agent terminals, a swarm map tree, plan checklists, active file tree, and code diff highlights. Run `/swarm` (or `/layout`) to toggle layouts instantly.
