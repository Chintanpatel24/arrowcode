/**
 * Parallel helpers — run independent tool calls and agent kicks concurrently.
 */

import { perf } from "./timers";

/**
 * Run async tasks with a concurrency limit (default 6).
 */
export async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (!items.length) return [];
  const limit = Math.max(1, Math.min(concurrency, items.length));
  const results = new Array<R>(items.length);
  let next = 0;

  async function run(): Promise<void> {
    while (next < items.length) {
      const i = next++;
      results[i] = await worker(items[i]!, i);
    }
  }

  const runners = Array.from({ length: limit }, () => run());
  await Promise.all(runners);
  return results;
}

/**
 * Execute independent tool calls in parallel when safe.
 * Tools that mutate files/bash run sequentially to preserve order & checkpoints.
 */
export function isParallelSafeTool(name: string): boolean {
  return [
    "read_file",
    "list_dir",
    "tree",
    "glob",
    "grep",
    "search_files",
    "find_symbol",
    "think",
    "git_status",
    "diff_workspace",
    "swarm_status",
    "memory_read",
    "notebook_read",
  ].includes(name);
}

export async function runToolsParallel<T extends { name: string }>(
  calls: T[],
  exec: (call: T) => Promise<unknown>,
  concurrency = 6,
): Promise<unknown[]> {
  if (calls.length <= 1) {
    const out: unknown[] = [];
    for (const c of calls) out.push(await exec(c));
    return out;
  }

  // Split into parallel-safe batch then sequential mutators, preserving relative order groups
  const results = new Array<unknown>(calls.length);
  let i = 0;
  while (i < calls.length) {
    if (!isParallelSafeTool(calls[i]!.name)) {
      results[i] = await exec(calls[i]!);
      i++;
      continue;
    }
    // gather contiguous parallel-safe slice
    let j = i;
    while (j < calls.length && isParallelSafeTool(calls[j]!.name)) j++;
    const slice = calls.slice(i, j);
    perf.inc("tools.parallel_batches");
    const part = await mapPool(slice, concurrency, async (c) => exec(c));
    for (let k = 0; k < part.length; k++) results[i + k] = part[k];
    i = j;
  }
  return results;
}

/** Fire-and-forget with error swallow (for non-critical UI/session flushes) */
export function defer(fn: () => void | Promise<void>): void {
  queueMicrotask(() => {
    Promise.resolve()
      .then(fn)
      .catch(() => {
        /* ignore */
      });
  });
}
