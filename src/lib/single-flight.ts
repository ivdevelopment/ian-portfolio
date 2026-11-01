/**
 * Runs one async job at a time. While a job is in flight further calls are ignored (they resolve to `undefined`), and the
 * flag is always released, also when the job throws (network error, server error), so a failure can never leave an action stuck.
 * The React hook `usePendingAction` is a thin wrapper that mirrors `busy` into state for rendering.
 */
export function createSingleFlight() {
  let busy = false;
  return {
    get busy() {
      return busy;
    },
    async run<T>(job: () => Promise<T>, onChange?: (busy: boolean) => void): Promise<T | undefined> {
      if (busy) return undefined;
      busy = true;
      onChange?.(true);
      try {
        return await job();
      } finally {
        busy = false;
        onChange?.(false);
      }
    },
  };
}
