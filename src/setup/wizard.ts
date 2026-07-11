/**
 * First-run setup wizard (plain terminal, no Ink).
 * Asks provider + API key, saves to ~/.arrowcode/.env and config.yaml
 */

import * as readline from "node:readline";
import {
  DEFAULT_NIM_BASE,
  DEFAULT_NIM_MODEL,
  DEFAULT_OPENAI_BASE,
  DEFAULT_OLLAMA_BASE,
  NIM_MODELS,
  type ProviderId,
} from "../config/types";
import {
  ensureArrowHome,
  saveConfig,
  saveEnv,
  resolveApiKeyEnvName,
} from "../config/load";
import { ENV_PATH, CONFIG_PATH, AGENTS_YAML_PATH, ARROW_HOME } from "../config/paths";
import { seedAgentPersonalities } from "../agents/personalities";
import { seedTemplates } from "../templates/catalog";
import { bootstrapUserHome } from "../bootstrap/install-home";

function ask(rl: readline.Interface, q: string): Promise<string> {
  return new Promise((resolve) => rl.question(q, (a) => resolve((a || "").trim())));
}

function line(ch = "-", n = 64): string {
  return ch.repeat(n);
}

export async function runSetupWizard(): Promise<boolean> {
  // First time: materialize ~/.arrowcode from repo defaults/
  const boot = bootstrapUserHome();
  ensureArrowHome();
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  try {
    console.log("");
    console.log(line("="));
    console.log("      /\\");
    console.log("     /  \\      ARROWCODE  setup");
    console.log("    / /\\ \\     swarm coding harness");
    console.log("   /______\\    ORCH · FE · BE · QA");
    console.log(line("="));
    console.log("");
    if (boot.createdHome) {
      console.log(`  Created user data dir from packaged defaults/:`);
      console.log(`    ${ARROW_HOME}`);
    } else {
      console.log(`  Using existing user data dir:`);
      console.log(`    ${ARROW_HOME}`);
    }
    console.log("  Credentials (this machine only):");
    console.log(`    ${ENV_PATH}`);
    console.log(`    ${CONFIG_PATH}`);
    console.log("");

    console.log("  Provider:");
    console.log("    1) NVIDIA NIM   (default — free keys at build.nvidia.com)");
    console.log("    2) OpenAI");
    console.log("    3) Anthropic");
    console.log("    4) Ollama       (local, no key)");
    console.log("    5) Custom OpenAI-compatible base URL");
    console.log("");

    const pAns = await ask(rl, "  Choose [1-5] (default 1): ");
    const map: Record<string, ProviderId> = {
      "": "nim",
      "1": "nim",
      "2": "openai",
      "3": "anthropic",
      "4": "ollama",
      "5": "custom",
    };
    const provider = map[pAns] || "nim";

    let baseUrl = DEFAULT_NIM_BASE;
    let model = DEFAULT_NIM_MODEL;
    let apiKey = "";

    if (provider === "nim") {
      baseUrl = DEFAULT_NIM_BASE;
      console.log("");
      console.log("  Get a free API key:  https://build.nvidia.com");
      console.log("  Key format:         nvapi-...");
      console.log("");
      console.log("  Suggested models:");
      for (const m of NIM_MODELS.slice(0, 6)) console.log(`    - ${m}`);
      console.log("");
      apiKey = await ask(rl, "  NVIDIA API key: ");
      const m = await ask(
        rl,
        `  Model (default ${DEFAULT_NIM_MODEL}): `,
      );
      model = m || DEFAULT_NIM_MODEL;
    } else if (provider === "openai") {
      baseUrl = DEFAULT_OPENAI_BASE;
      model = "gpt-4.1";
      apiKey = await ask(rl, "  OpenAI API key: ");
      const m = await ask(rl, "  Model (default gpt-4.1): ");
      model = m || "gpt-4.1";
    } else if (provider === "anthropic") {
      baseUrl = "https://api.anthropic.com/v1";
      model = "claude-sonnet-4-20250514";
      apiKey = await ask(rl, "  Anthropic API key: ");
      const m = await ask(rl, `  Model (default ${model}): `);
      model = m || model;
    } else if (provider === "ollama") {
      baseUrl = DEFAULT_OLLAMA_BASE;
      model = "qwen2.5-coder:14b";
      apiKey = "ollama";
      const b = await ask(rl, `  Ollama base URL (default ${baseUrl}): `);
      baseUrl = b || baseUrl;
      const m = await ask(rl, `  Model (default ${model}): `);
      model = m || model;
    } else {
      baseUrl =
        (await ask(rl, "  Base URL (e.g. http://localhost:8000/v1): ")) ||
        DEFAULT_OPENAI_BASE;
      apiKey = await ask(rl, "  API key (or 'none'): ");
      if (apiKey === "none") apiKey = "not-needed";
      model =
        (await ask(rl, "  Model id: ")) || DEFAULT_NIM_MODEL;
    }

    if (provider !== "ollama" && !apiKey) {
      console.log("");
      console.log("  No API key entered. Setup cancelled.");
      console.log("  Re-run:  arrowcode --setup");
      return false;
    }

    const yoloAns = await ask(
      rl,
      "  Auto-approve write/bash tools? [y/N]: ",
    );
    const autoApprove = /^y(es)?$/i.test(yoloAns);

    const envKey = resolveApiKeyEnvName(provider);
    const envVars: Record<string, string> = {
      ARROWCODE_PROVIDER: provider,
      ARROWCODE_MODEL: model,
      ARROWCODE_BASE_URL: baseUrl,
      ARROWCODE_YOLO: autoApprove ? "1" : "0",
      [envKey]: apiKey,
    };
    // always mirror NIM key under NVIDIA_API_KEY when provider is nim
    if (provider === "nim") {
      envVars.NVIDIA_API_KEY = apiKey;
    }

    saveEnv(envVars);
    saveConfig({
      provider,
      model,
      baseUrl,
      autoApprove,
      temperature: 0.2,
      maxTokens: 8192,
      maxToolRounds: 28,
      maxExecuteCycles: 12,
      apiKey: "", // keep secret in .env only
      swarm: {
        maxWorkers: 16,
        maxDepth: 2,
        maxChildrenPerAgent: 4,
        summarizeThresholdChars: 100_000,
        keepRecentMessages: 14,
        enabled: true,
      },
      contextBudgetChars: 120_000,
    });
    bootstrapUserHome();
    seedAgentPersonalities();
    seedTemplates();

    console.log("");
    console.log(line("-"));
    console.log("  Setup complete.");
    console.log(`  Provider : ${provider}`);
    console.log(`  Model    : ${model}`);
    console.log(`  Base URL : ${baseUrl}`);
    console.log(`  Env file : ${ENV_PATH}`);
    console.log(`  Agents   : ${AGENTS_YAML_PATH}`);
    console.log("");
    console.log("  Per-agent APIs (optional): edit agents.yaml or set");
    console.log("    ARROW_FE_API_KEY / ARROW_BE_MODEL / ...");
    console.log("");
    console.log("  Start in any project:");
    console.log("    cd /path/to/project && arrowcode");
    console.log("");
    console.log("  Flow: /plan -> questions -> /confirm -> /accept");
    console.log(line("="));
    console.log("");
    return true;
  } finally {
    rl.close();
  }
}
