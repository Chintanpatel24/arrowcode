/**
 * Goal templates:
 * - Packaged in repo: defaults/templates/*.md
 * - User copy: ~/.arrowcode/templates (only if user home already installed)
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  copyFileSync,
} from "node:fs";
import { join } from "node:path";
import { TEMPLATES_DIR, defaultsTemplatesDir } from "../config/paths";
import { bootstrapUserHome, isUserHomePresent } from "../bootstrap/install-home";
import type { TemplateId } from "../config/types";

export interface GoalTemplate {
  id: string;
  name: string;
  description: string;
  body: string;
  checklist: string[];
}

function parseTemplateFile(fallbackId: string, raw: string): GoalTemplate {
  if (raw.startsWith("---")) {
    const end = raw.indexOf("---", 3);
    if (end > 0) {
      const fm = raw.slice(3, end).trim();
      const body = raw.slice(end + 3).trim();
      const meta: Record<string, string> = {};
      const checklist: string[] = [];
      let inCheck = false;
      for (const line of fm.split("\n")) {
        if (/^checklist:\s*$/.test(line)) {
          inCheck = true;
          continue;
        }
        if (inCheck) {
          const m = line.match(/^\s*-\s+(.*)/);
          if (m) {
            checklist.push(m[1]!.trim());
            continue;
          }
          inCheck = false;
        }
        const kv = line.match(/^(\w+):\s*(.*)$/);
        if (kv) meta[kv[1]!] = kv[2]!.trim();
      }
      return {
        id: meta.id || fallbackId,
        name: meta.name || fallbackId,
        description: meta.description || "",
        checklist: checklist.length ? checklist : ["User accepted"],
        body,
      };
    }
  }
  return {
    id: fallbackId,
    name: fallbackId,
    description: "",
    checklist: ["User accepted"],
    body: raw,
  };
}

function loadFromDir(dir: string): Map<string, GoalTemplate> {
  const map = new Map<string, GoalTemplate>();
  if (!existsSync(dir)) return map;
  for (const f of readdirSync(dir)) {
    if (!f.endsWith(".md")) continue;
    try {
      const raw = readFileSync(join(dir, f), "utf8");
      const parsed = parseTemplateFile(f.replace(/\.md$/, ""), raw);
      map.set(parsed.id, parsed);
    } catch {
      /* skip bad file */
    }
  }
  return map;
}

/** Copy packaged templates into ~/.arrowcode/templates if missing. Never creates home alone. */
export function seedTemplates(): void {
  if (!isUserHomePresent()) return;
  bootstrapUserHome();
  const src = defaultsTemplatesDir();
  if (!existsSync(src)) return;
  mkdirSync(TEMPLATES_DIR, { recursive: true });
  for (const f of readdirSync(src)) {
    if (!f.endsWith(".md")) continue;
    const dest = join(TEMPLATES_DIR, f);
    if (existsSync(dest)) continue;
    copyFileSync(join(src, f), dest);
  }
}

export function listTemplates(): GoalTemplate[] {
  // Always load packaged defaults from the repo
  const packaged = loadFromDir(defaultsTemplatesDir());
  // Merge user overrides only if home templates dir already exists
  try {
    if (isUserHomePresent() && existsSync(TEMPLATES_DIR)) {
      for (const [id, t] of loadFromDir(TEMPLATES_DIR)) {
        packaged.set(id, t);
      }
    }
  } catch {
    /* */
  }
  return [...packaged.values()].sort((a, b) => a.id.localeCompare(b.id));
}

export function getTemplate(id?: TemplateId | null): GoalTemplate | undefined {
  if (!id) return undefined;
  return listTemplates().find((t) => t.id === id);
}
