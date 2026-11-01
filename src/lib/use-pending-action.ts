"use client";

import { useState } from "react";
import { createSingleFlight } from "./single-flight";

/**
 * `const { pending, run } = usePendingAction();` then `run(async () => { ... })`.
 * `pending` is true while the job runs; a second `run` while pending is ignored (no duplicate submit); `pending` always returns
 * to false, also when the job throws.
 */
export function usePendingAction() {
  const [pending, setPending] = useState(false);
  const [runner] = useState(() => {
    const flight = createSingleFlight();
    return <T,>(job: () => Promise<T>) => flight.run(job, setPending);
  });
  return { pending, run: runner };
}
