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
    console.log(
      "This will create ~/.arrowcode from packaged defaults/ and ask for an API key.\n",
    );
    bootstrapUserHome();
    const ok = await runSetupWizard();
    if (!ok) process.exit(1);
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

  if (values["no-tui"]) {
    if (!prompt) {
      console.error("Headless mode requires a prompt.");
      process.exit(1);
    }
    harness.events.on((e) => {
      if (e.type === "phase")
        console.log(`[phase] ${e.phase} ${e.detail || ""}`);
      else if (e.type === "agent_log" && e.line.kind !== "say")
        console.log(`[${e.agent}] ${e.line.kind}: ${e.line.text}`);
      else if (e.type === "agent_log" && e.line.kind === "say")
        process.stdout.write(e.line.text);
      else if (e.type === "bus")
        console.log(
          `[bus] ${e.message.from} -> ${e.message.to} [${e.message.kind}] ${e.message.title}`,
        );
      else if (e.type === "system") console.log(`[system] ${e.text}`);
      else if (e.type === "plan")
        console.log(`[plan] ${e.plan.title}\n${e.plan.summary}`);
      else if (e.type === "questions")
        console.log(
          `[questions]\n${e.questions.map((q, i) => `${i + 1}. ${q.question}`).join("\n")}`,
        );
      else if (e.type === "final") console.log("\n=== READY ===\n" + e.text);
      else if (e.type === "swarm")
        console.log(`[swarm] ${e.action} ${e.workerId} active=${e.active}`);
      else if (e.type === "approval_request") {
        if (cfg.autoApprove) harness.resolveApproval(e.id, true);
        else {
          console.log(`[approval] denied (use -y): ${e.agent} ${e.tool}`);
          harness.resolveApproval(e.id, false);
        }
      }
    });
    await harness.startPlan(prompt);
    if (harness.plan) {
      console.log("\n[headless] auto /confirm");
      await harness.confirmAndExecute();
    }
    console.log("\n[metrics]", harness.metricsLine());
    process.exit(0);
  }

  const { waitUntilExit } = render(
    React.createElement(App, {
      harness,
      config: cfg,
      initialPrompt: prompt || undefined,
    }),
    { exitOnCtrlC: true },
  );

  await waitUntilExit();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
