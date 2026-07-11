/**
 * Runtime safety policy: dry-run, deny paths, bash allowlist, secret scan, cost budget.
 */

import type { ArrowConfig } from "../config/types";
import {
  isBashAllowlisted,
  isDeniedPath,
  scanSecrets,
} from "./checkpoints";

export interface PolicyConfig {
  dryRun: boolean;
  /** Soft stop when total tokens exceed this (0 = off) */
  tokenBudget: number;
  /** Auto-approve allowlisted bash even if not YOLO */
  bashAllowlist: boolean;
  /** Block writes that look like secrets */
  secretScan: boolean;
  /** Block denied paths (.env, keys, etc.) */
  denySensitivePaths: boolean;
}

export const DEFAULT_POLICY: PolicyConfig = {
  dryRun: false,
  tokenBudget: 0,
  bashAllowlist: true,
  secretScan: true,
  denySensitivePaths: true,
};

export type PolicyDecision =
  | { allow: true; autoApprove?: boolean; note?: string }
  | { allow: false; reason: string };

export function evaluateToolPolicy(
  tool: string,
  args: Record<string, unknown>,
  policy: PolicyConfig,
  opts: { autoApprove: boolean; tokensUsed: number },
): PolicyDecision {
  if (policy.tokenBudget > 0 && opts.tokensUsed >= policy.tokenBudget) {
    return {
      allow: false,
      reason: `Token budget reached (${opts.tokensUsed}/${policy.tokenBudget}). /budget 0 to clear.`,
    };
  }

  const writeTools = new Set([
    "write_file",
    "edit_file",
    "multi_edit",
    "delete_file",
    "move_file",
    "apply_patch",
  ]);

  if (policy.dryRun && (writeTools.has(tool) || tool === "bash")) {
    if (tool === "bash") {
      const cmd = String(args.command || "");
      // allow read-only allowlisted even in dry-run
      if (policy.bashAllowlist && isBashAllowlisted(cmd)) {
        return { allow: true, autoApprove: true, note: "dry-run: allowlisted bash" };
      }
      return {
        allow: false,
        reason: `Dry-run mode: blocked bash. /dryrun off to disable. cmd=${cmd.slice(0, 80)}`,
      };
    }
    return {
      allow: false,
      reason: `Dry-run mode: blocked ${tool} on ${String(args.path || args.from || "")}. /dryrun off to write.`,
    };
  }

  if (policy.denySensitivePaths) {
    const paths: string[] = [];
    if (args.path) paths.push(String(args.path));
    if (args.from) paths.push(String(args.from));
    if (args.to) paths.push(String(args.to));
    if (Array.isArray(args.edits)) {
      for (const e of args.edits as { path?: string }[]) {
        if (e?.path) paths.push(String(e.path));
      }
    }
    for (const p of paths) {
      if (isDeniedPath(p)) {
        return {
          allow: false,
          reason: `Denied sensitive path: ${p} (policy denySensitivePaths)`,
        };
      }
    }
  }

  if (policy.secretScan && (tool === "write_file" || tool === "edit_file")) {
    const content =
      tool === "write_file"
        ? String(args.content || "")
        : String(args.new_text || "");
    const hits = scanSecrets(content);
    if (hits.length) {
      return {
        allow: false,
        reason: `Secret scan blocked write (${hits.join(", ")}). Remove secrets or disable with /secretscan off.`,
      };
    }
  }

  if (tool === "bash" && policy.bashAllowlist && isBashAllowlisted(String(args.command || ""))) {
    return { allow: true, autoApprove: true, note: "bash allowlist" };
  }

  if (opts.autoApprove) return { allow: true, autoApprove: true };
  return { allow: true };
}
