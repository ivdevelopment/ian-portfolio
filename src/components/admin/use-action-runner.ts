"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

export const NETWORK_ERROR = "That didn't go through. Check your connection and try again.";

type Outcome = { ok: boolean; error?: string; warning?: string };

/**
 * One row's (or one panel's) server actions, with the loading behaviour every admin action needs:
 *  - `active` is the key of the action that is running (so only THAT button shows a spinner),
 *  - a second action while one is running is ignored (no double submit, no repeated status transitions),
 *  - a failure (validation message, server error, or a thrown network error) always ends the pending state and surfaces `error`,
 *  - on success the route is refreshed inside the same transition, so `pending` stays true until the new data is on screen.
 */
export function useActionRunner() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [active, setActive] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = <R extends Outcome>(key: string, job: () => Promise<R>, after?: (result: R) => void) => {
    if (active !== null || isPending) return;
    setActive(key);
    setError(null);
    startTransition(async () => {
      try {
        const result = await job();
        if (!result.ok) {
          setError(result.error ?? "That couldn't be done.");
          return;
        }
        after?.(result);
        router.refresh();
      } catch {
        setError(NETWORK_ERROR);
      } finally {
        setActive(null);
      }
    });
  };

  return { run, active, pending: active !== null || isPending, error, setError };
}
