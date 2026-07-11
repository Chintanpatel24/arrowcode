/**
 * Lightweight performance timers & counters for lightning diagnostics.
 */

export interface PerfSnapshot {
  counters: Record<string, number>;
  timingsMs: Record<string, { count: number; total: number; max: number }>;
  startedAt: number;
}

class PerfRegistry {
  private counters = new Map<string, number>();
  private timings = new Map<
    string,
    { count: number; total: number; max: number }
  >();
  readonly startedAt = Date.now();

  inc(name: string, n = 1): void {
    this.counters.set(name, (this.counters.get(name) || 0) + n);
  }

  time<T>(name: string, fn: () => T): T {
    const t0 = performance.now();
    try {
      return fn();
    } finally {
      this.record(name, performance.now() - t0);
    }
  }

  async timeAsync<T>(name: string, fn: () => Promise<T>): Promise<T> {
    const t0 = performance.now();
    try {
      return await fn();
    } finally {
      this.record(name, performance.now() - t0);
    }
  }

  record(name: string, ms: number): void {
    const cur = this.timings.get(name) || { count: 0, total: 0, max: 0 };
    cur.count += 1;
    cur.total += ms;
    cur.max = Math.max(cur.max, ms);
    this.timings.set(name, cur);
  }

  snapshot(): PerfSnapshot {
    const counters: Record<string, number> = {};
    for (const [k, v] of this.counters) counters[k] = v;
    const timingsMs: PerfSnapshot["timingsMs"] = {};
    for (const [k, v] of this.timings) timingsMs[k] = { ...v };
    return { counters, timingsMs, startedAt: this.startedAt };
  }

  summary(limit = 12): string {
    const s = this.snapshot();
    const lines: string[] = [
      `perf uptime ${((Date.now() - s.startedAt) / 1000).toFixed(1)}s`,
    ];
    const times = Object.entries(s.timingsMs)
      .sort((a, b) => b[1].total - a[1].total)
      .slice(0, limit);
    for (const [k, v] of times) {
      const avg = v.count ? v.total / v.count : 0;
      lines.push(
        `  ${k}: n=${v.count} total=${v.total.toFixed(1)}ms avg=${avg.toFixed(1)}ms max=${v.max.toFixed(1)}ms`,
      );
    }
    const ctr = Object.entries(s.counters)
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit);
    if (ctr.length) {
      lines.push("  counters:");
      for (const [k, v] of ctr) lines.push(`    ${k}=${v}`);
    }
    return lines.join("\n");
  }

  reset(): void {
    this.counters.clear();
    this.timings.clear();
  }
}

export const perf = new PerfRegistry();
