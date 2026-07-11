/**
 * Materialize ~/.arrowcode from packaged defaults/ — only when missing.
 * Called by: install.sh, install.ps1, --setup, --init, first run.
 */

import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import {
  AGENTS_DIR,
  AGENTS_YAML_PATH,
  ARROW_HOME,
  CONFIG_PATH,
  MEMORY_DIR,
  SESSIONS_DIR,
  TEMPLATES_DIR,
  defaultsAgentsDir,
  defaultsConfigDir,
  defaultsTemplatesDir,
} from "./paths";

export interface BootstrapResult {
  createdHome: boolean;
  agents: string[];
  templates: string[];
  home: string;
}

function ensureDir(p: string) {
  mkdirSync(p, { recursive: true });
}

function copyDirMd(srcDir: string, destDir: string): string[] {
  const written: string[] = [];
  if (!existsSync(srcDir)) return written;
  ensureDir(destDir);
  for (const f of readdirSync(srcDir)) {
    if (!f.endsWith(".md")) continue;
    const dest = join(destDir, f);
    if (existsSync(dest)) continue; // never overwrite user edits
    copyFileSync(join(srcDir, f), dest);
    written.push(f);
  }
  return written;
}

/**
 * Create ~/.arrowcode structure from repo defaults/.
 * Idempotent: never overwrites existing user files.
 */
export function bootstrapUserHome(opts?: {
  forceExampleConfig?: boolean;
}): BootstrapResult {
  const existed = existsSync(ARROW_HOME);
  ensureDir(ARROW_HOME);
  ensureDir(AGENTS_DIR);
  ensureDir(TEMPLATES_DIR);
  ensureDir(SESSIONS_DIR);
  ensureDir(MEMORY_DIR);

  const agents = copyDirMd(defaultsAgentsDir(), AGENTS_DIR);
  const templates = copyDirMd(defaultsTemplatesDir(), TEMPLATES_DIR);

  // agents.yaml example
  const agentsYamlSrc = join(defaultsConfigDir(), "agents.yaml");
  if (!existsSync(AGENTS_YAML_PATH) && existsSync(agentsYamlSrc)) {
    copyFileSync(agentsYamlSrc, AGENTS_YAML_PATH);
  }

  // example config as config.example.yaml in home (not overwriting real config)
  const exampleSrc = join(defaultsConfigDir(), "config.example.yaml");
  const exampleDest = join(ARROW_HOME, "config.example.yaml");
  if (existsSync(exampleSrc) && (!existsSync(exampleDest) || opts?.forceExampleConfig)) {
    copyFileSync(exampleSrc, exampleDest);
  }

  // marker so installers know home was bootstrapped
  const marker = join(ARROW_HOME, ".bootstrapped");
  if (!existsSync(marker)) {
    writeFileSync(
      marker,
      `bootstrapped=${new Date().toISOString()}\nsource=arrowcode-defaults\n`,
      "utf8",
    );
  }

  return {
    createdHome: !existed,
    agents,
    templates,
    home: ARROW_HOME,
  };
}

/** Read packaged agent text (for fallback if home missing mid-run). */
export function readPackagedAgent(file: string): string | null {
  const p = join(defaultsAgentsDir(), file);
  if (!existsSync(p)) return null;
  return readFileSync(p, "utf8");
}

export function isUserHomePresent(): boolean {
  return existsSync(ARROW_HOME) && existsSync(join(ARROW_HOME, ".bootstrapped"));
}
