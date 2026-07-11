/**
 * Debounced / coalesced writers for session & disk I/O speed.
 */

export function debounce<T extends (...args: never[]) => void>(
  fn: T,
  waitMs: number,
): T & { flush: () => void; cancel: () => void } {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let lastArgs: Parameters<T> | null = null;

  const wrapped = ((...args: Parameters<T>) => {
    lastArgs = args;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      if (lastArgs) fn(...lastArgs);
      lastArgs = null;
    }, waitMs);
  }) as T & { flush: () => void; cancel: () => void };

  wrapped.flush = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    if (lastArgs) {
      fn(...lastArgs);
      lastArgs = null;
    }
  };

  wrapped.cancel = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    lastArgs = null;
  };

  return wrapped;
}

/** Coalesce multiple saves into one per interval */
export class SaveCoalescer {
  private dirty = false;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private saveFn: () => void,
    private waitMs = 200,
  ) {}

  mark(): void {
    this.dirty = true;
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      if (this.dirty) {
        this.dirty = false;
        try {
          this.saveFn();
        } catch {
          /* */
        }
      }
    }, this.waitMs);
  }

  flush(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.dirty) {
      this.dirty = false;
      this.saveFn();
    }
  }
}
