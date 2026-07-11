/**
 * ArrowCode performance kit — caches, timers, parallel tools, fast context.
 */
export { LRUCache, TTLCache, perfCaches, invalidateFileCaches } from "./cache";
export { perf, type PerfSnapshot } from "./timers";
export {
  mapPool,
  runToolsParallel,
  isParallelSafeTool,
  defer,
} from "./parallel";
export { manageContextFast, fastHash } from "./fast-context";
export { debounce, SaveCoalescer } from "./debounce";

export const PERF_DEFAULTS = {
  /** Parallel read-only tools per agent turn */
  toolConcurrency: 8,
  /** Prefer pure trim unless massively over budget */
  pureTrimBias: true,
  /** Session save coalesce ms */
  sessionSaveMs: 250,
  /** Wait-until-idle poll ms (lower = snappier phase end detection) */
  idlePollMs: 120,
  /** Idle settle ms before considering agents done */
  idleSettleMs: 400,
  /** File content cache */
  fileCacheCapacity: 256,
} as const;
