"use client";

import { useCallback, useState } from "react";
import { snapshotEqual } from "@/lib/dirty";
import type { SaveStatus } from "./form-bits";

/**
 * Dirty tracking for editors that keep their values in React state (lists and
 * translation panels). The form is dirty exactly when the current value differs
 * from the last successfully saved snapshot, so changing something back makes it
 * clean again, and a failed save leaves it dirty.
 *
 *   const { value, setValue, dirty, status, save } = useDirtySaveState(initial, action);
 *
 * `action` receives the value being saved and returns `{ ok: true }` or `{ ok: false, error }`.
 * The baseline is set to the snapshot that was sent, so edits made while the request
 * was running keep the form dirty.
 */
export function useDirtySaveState<T>(
  initial: T,
  action: (value: T) => Promise<{ ok: true; warning?: string } | { ok: false; error: string }>,
  onSaved?: () => void,
) {
  const [value, setValueState] = useState<T>(initial);
  const [baseline, setBaseline] = useState<T>(initial);
  const [status, setStatus] = useState<SaveStatus>({ kind: "idle" });

  const dirty = !snapshotEqual(value, baseline);

  const setValue = useCallback((next: T | ((current: T) => T)) => {
    setValueState(next);
    // Editing clears a previous error / "Saved" note.
    setStatus((s) => (s.kind === "saving" ? s : { kind: "idle" }));
  }, []);

  const save = useCallback(async () => {
    const snapshot = value;
    setStatus({ kind: "saving" });
    const result = await action(snapshot);
    if (!result.ok) {
      setStatus({ kind: "error", message: result.error });
      return;
    }
    setBaseline(snapshot);
    setStatus({ kind: "saved", warning: result.warning });
    onSaved?.();
  }, [value, action, onSaved]);

  return { value, setValue, dirty, status, save };
}
