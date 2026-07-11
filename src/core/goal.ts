import type { GoalState } from "../config/types";
import { loadGoalFile, saveGoalFile } from "../config/load";
import { getTemplate } from "../templates/catalog";

export function parseGoalMarkdown(md: string): GoalState {
  const now = Date.now();
  let text = md.trim();
  let templateId: string | undefined;
  const checklist: GoalState["checklist"] = [];

  // Optional front matter-ish first line: template: feature
  const lines = text.split("\n");
  if (lines[0] && /^template:\s*/i.test(lines[0])) {
    templateId = lines[0].replace(/^template:\s*/i, "").trim();
    text = lines.slice(1).join("\n").trim();
  }

  // Extract markdown checkboxes
  const kept: string[] = [];
  for (const line of text.split("\n")) {
    const m = line.match(/^\s*[-*]\s+\[([ xX])\]\s+(.*)$/);
    if (m) {
      checklist.push({
        id: `c${checklist.length + 1}`,
        text: m[2]!.trim(),
        done: m[1] !== " ",
      });
    } else {
      kept.push(line);
    }
  }
  text = kept.join("\n").trim();

  if (!checklist.length && templateId) {
    const t = getTemplate(templateId);
    if (t) {
      for (const c of t.checklist) {
        checklist.push({ id: `c${checklist.length + 1}`, text: c, done: false });
      }
    }
  }

  return {
    text,
    templateId,
    checklist,
    createdAt: now,
    updatedAt: now,
  };
}

export function serializeGoal(goal: GoalState): string {
  const lines: string[] = [];
  if (goal.templateId) lines.push(`template: ${goal.templateId}`, "");
  lines.push(goal.text.trim(), "");
  if (goal.checklist.length) {
    lines.push("## Checklist");
    for (const c of goal.checklist) {
      lines.push(`- [${c.done ? "x" : " "}] ${c.text}`);
    }
  }
  return lines.join("\n") + "\n";
}

export function loadGoal(): GoalState | null {
  const raw = loadGoalFile();
  if (!raw.trim()) return null;
  return parseGoalMarkdown(raw);
}

export function saveGoal(goal: GoalState): void {
  goal.updatedAt = Date.now();
  // Global ~/.arrowcode/goal.md only if home already installed; sessions hold workspace goal
  try {
    saveGoalFile(serializeGoal(goal));
  } catch {
    /* optional */
  }
}

export function createGoalFromText(
  text: string,
  templateId?: string,
): GoalState {
  const base = parseGoalMarkdown(
    (templateId ? `template: ${templateId}\n\n` : "") + text,
  );
  if (templateId && !base.templateId) base.templateId = templateId;
  if (!base.checklist.length && templateId) {
    const t = getTemplate(templateId);
    if (t) {
      base.checklist = t.checklist.map((c, i) => ({
        id: `c${i + 1}`,
        text: c,
        done: false,
      }));
    }
  }
  saveGoal(base);
  return base;
}

export function goalContextBlock(goal: GoalState | null): string {
  if (!goal || !goal.text.trim()) return "No persistent goal set.";
  const checks = goal.checklist.length
    ? goal.checklist
        .map((c) => `- [${c.done ? "x" : " "}] ${c.text}`)
        .join("\n")
    : "(no checklist)";
  return [
    "## Active Goal",
    goal.templateId ? `Template: ${goal.templateId}` : "",
    goal.text,
    "",
    "### Checklist",
    checks,
  ]
    .filter(Boolean)
    .join("\n");
}
