#!/usr/bin/env bun
/**
 * ArrowCode — multi-agent swarm coding harness
 * Plan -> Questions -> Confirm -> Execute (swarm) until /accept
 */

import { parseArgs } from "node:util";
import { resolve } from "node:path";
import React from "react";
import { render } from "ink";
import { isConfigured, loadConfig, loadDotEnv } from "./config/load";
import { runSetupWizard } from "./setup/wizard";
import { Harness } from "./core/harness";
import { App } from "./tui/App";
import { NIM_MODELS } from "./config/types";
import { seedAgentPersonalities } from "./agents/personalities";
import { seedTemplates } from "./templates/catalog";
import { printBanner } from "./brand/banner";
import { bootstrapUserHome } from "./bootstrap/install-home";

const VERSION = "1.0.0";

function printHelp() {
  printBanner({ compact: (process.stdout.columns || 80) < 90 });
  console.log(`ARROWCODE v${VERSION}  — multi-agent swarm coding harness

Usage:
  arrowcode [options] [prompt...]
  arrowcode --setup
  arrowcode --list-models

Flow:
  /plan -> clarifying questions -> /confirm -> execute (swarm) -> /accept

Swarm:
  Main agents spawn workers (depth 2, max 16).
  Per-agent APIs: ~/.arrowcode/agents.yaml  or  ARROW_FE_* / ARROW_BE_* env

Options:
  -h, --help            Show help
  -v, --version         Version
  --banner              Print ASCII banner
  -m, --model <id>      Model override
  -p, --provider <id>   nim | openai | anthropic | ollama | custom
  --api-key <key>       API key (else ~/.arrowcode/.env)
  --base-url <url>      OpenAI-compatible base URL
  -w, --workspace <dir> Workspace root (default: cwd)
  -y, --yolo            Auto-approve write/bash tools
  --setup               Run API key setup wizard
  --list-models         Recommended NIM models
  --no-tui              Headless mode
  --init                Seed agent personalities + templates

Agents (parallel panes):
  ORCH  plan & coordinate
  FE    frontend
  BE    backend
  QA    tester

Install:
  ./install.sh
  # or: curl -fsSL <raw-install.sh> | bash

Docs:
  GUIDE.md  ·  README.md  ·  docs/
`);
}

async function main() {
  const { values, positionals } = parseArgs({
    args: Bun.argv.slice(2),
    allowPositionals: true,
    options: {
      help: { type: "boolean", short: "h" },
      version: { type: "boolean", short: "v" },
      banner: { type: "boolean" },
      model: { type: "string", short: "m" },
      provider: { type: "string", short: "p" },
      "api-key": { type: "string" },
      "base-url": { type: "string" },
      workspace: { type: "string", short: "w" },
      yolo: { type: "boolean", short: "y" },
      yes: { type: "boolean" },
      setup: { type: "boolean" },
      "list-models": { type: "boolean" },
      "no-tui": { type: "boolean" },
      init: { type: "boolean" },
    },
  });

  if (values.help) {
    printHelp();
    process.exit(0);
  }
  if (values.version) {
    console.log(`arrowcode ${VERSION}`);
    process.exit(0);
  }
  if (values.banner) {
    printBanner();
    process.exit(0);
  }
  if (values["list-models"]) {
    printBanner({ compact: true });
    console.log("Recommended NVIDIA NIM models:");
    for (const m of NIM_MODELS) console.log(`  ${m}`);
    console.log("\nCatalog: https://build.nvidia.com/models");
    process.exit(0);
  }

  loadDotEnv();

  if (values.init) {
    const r = bootstrapUserHome();
    seedAgentPersonalities();
    seedTemplates();
    console.log(
      r.createdHome
        ? `Created ${r.home} from packaged defaults/`
        : `Updated missing files in ${r.home} (existing files kept)`,
    );
    console.log(
      `  agents: ${r.agents.length ? r.agents.join(", ") : "(already present)"}`,
    );
    console.log(
      `  templates: ${r.templates.length ? r.templates.length + " new" : "(already present)"}`,
    );
    process.exit(0);
  }

  if (values.setup) {
    printBanner({ compact: true });
    bootstrapUserHome();
    const ok = await runSetupWizard();
    process.exit(ok ? 0 : 1);
  }

  if (!isConfigured()) {
    printBanner({ compact: true });
    console.log("ArrowCode is not configured yet.\n");
    console.log("Welcome to ArrowCode! Since you don't have an API key configured yet,");
    console.log("you can choose one of the following options to get started immediately:");
    console.log("  1) Use Mock / Demo mode (free, runs locally, no keys needed)");
    console.log("  2) Configure a real LLM provider (NVIDIA NIM, OpenAI, Anthropic, etc.)");
    console.log("");
    const readline = await import("node:readline");
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    const choice = await new Promise<string>((res) => {
      rl.question("Choose [1-2] (default 1): ", (ans) => res((ans || "").trim()));
    });
    rl.close();

    bootstrapUserHome();

    if (choice === "2") {
      const ok = await runSetupWizard();
      if (!ok) process.exit(1);
      if (!isConfigured()) {
        process.exit(0);
      }
    } else {
      // Setup demo/mock mode
      const { saveEnv, saveConfig } = await import("./config/load");
      saveEnv({
        ARROWCODE_PROVIDER: "demo",
        ARROWCODE_MODEL: "demo-v1",
        ARROWCODE_BASE_URL: "demo",
        DEMO_API_KEY: "demo",
      });
      saveConfig({
        provider: "demo",
        model: "demo-v1",
        baseUrl: "demo",
        apiKey: "demo",
      });
      console.log("\nDemo Mode configured! Starting ArrowCode...\n");
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }

  // Runtime: packaged defaults work without home; seed if home already exists
  try {
    seedTemplates();
    seedAgentPersonalities();
  } catch {
    /* packaged */
  }

  const cfg = loadConfig({
    model: values.model,
    provider: values.provider as never,
    apiKey: values["api-key"],
    baseUrl: values["base-url"],
    workspace: values.workspace ? resolve(values.workspace) : process.cwd(),
    autoApprove: values.yolo || values.yes || undefined,
  });
  cfg.workspace = resolve(cfg.workspace);

  if (!cfg.apiKey && cfg.provider !== "ollama") {
    console.error("No API key found. Run: arrowcode --setup");
    process.exit(2);
  }

  const prompt = positionals.join(" ").trim();
  const harness = new Harness(cfg);

  harness.events.on((e) => {
    if (e.type === "agent_log") {
      if (e.line.kind === "say") {
        process.stdout.write(e.line.text);
      } else if (e.line.kind === "error") {
        console.log(`\nError: ${e.line.text}`);
      }
    } else if (e.type === "plan") {
      console.log(`\n=================== PLAN ===================`);
      console.log(`Title: ${e.plan.title}`);
      console.log(`Summary: ${e.plan.summary}`);
      console.log(`============================================\n`);
    } else if (e.type === "questions") {
      console.log(`\n================= QUESTIONS =================`);
      console.log(e.questions.map((q, i) => `${i + 1}. ${q.question}`).join("\n"));
      console.log(`=============================================\n`);
    } else if (e.type === "final") {
      console.log("\n=== READY ===\n" + e.text);
    } else if (e.type === "approval_request") {
      harness.resolveApproval(e.id, true);
    }
  });

  if (prompt) {
    await harness.startPlan(prompt);
    if (harness.plan) {
      console.log("\n[headless] auto /confirm");
      await harness.confirmAndExecute();
    }
    console.log("\n[metrics]", harness.metricsLine());
    process.exit(0);
  } else {
    // Enter alternate screen buffer to cleanly overtake the whole terminal canvas
    // and hide scrollback history while running.
    process.stdout.write("\x1b[?1049h\x1b[H");

    const exitAlternateScreen = () => {
      process.stdout.write("\x1b[?1049l\x1b[?25h");
    };

    process.on("exit", exitAlternateScreen);
    process.on("SIGINT", () => {
      exitAlternateScreen();
      process.exit(130);
    });
    process.on("uncaughtException", (err) => {
      exitAlternateScreen();
      console.error(err);
      process.exit(1);
    });

    try {
      const { render } = await import("ink");
      const { App } = await import("./tui/App");
      const { waitUntilExit } = render(
        React.createElement(App, {
          harness,
          config: cfg,
          initialPrompt: undefined,
        }),
        { exitOnCtrlC: true },
      );
      await waitUntilExit();
    } finally {
      exitAlternateScreen();
    }
    process.exit(0);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
