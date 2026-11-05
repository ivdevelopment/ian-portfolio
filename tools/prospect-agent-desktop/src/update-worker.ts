import { parentPort, workerData } from "node:worker_threads";
import { updateBusinessData, type UpdateResult, type UpdateStage } from "../../prospect-agent/src/osm/data-manager";

/**
 * Runs the business-data update on its own thread. Building the index reads the whole Belgium extract synchronously, which would freeze the tray
 * app (and its heartbeats) if it ran on the main thread. The update logic itself is the same `updateBusinessData` the command line uses.
 */
export type ToMain = { type: "stage"; stage: UpdateStage } | { type: "log"; message: string } | { type: "result"; result: UpdateResult } | { type: "error"; message: string };

const post = (m: ToMain) => parentPort?.postMessage(m);
const { home, force } = workerData as { home: string; force: boolean };

updateBusinessData({ home, force, onStage: (stage) => post({ type: "stage", stage }), log: (message) => post({ type: "log", message }) }).then(
  (result) => post({ type: "result", result }),
  (e) => post({ type: "error", message: e instanceof Error ? e.message : "Update failed" }),
);
