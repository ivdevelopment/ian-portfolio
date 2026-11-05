import { Worker } from "node:worker_threads";
import { businessDataStatus, type UpdateDeps, type UpdateResult } from "../../prospect-agent/src/osm/data-manager";
import type { ToMain } from "./update-worker";

/** The `updateBusinessData` dependency the tray app hands to the service: same logic, run on a worker thread. */
export function threadedUpdate(workerFile: string): (deps: UpdateDeps) => Promise<UpdateResult> {
  return (deps) =>
    new Promise<UpdateResult>((resolve) => {
      const home = deps.home as string;
      const failed = (message: string): UpdateResult => ({ outcome: "failed", message, status: businessDataStatus(home) });
      let settled = false;
      const finish = (r: UpdateResult) => {
        if (settled) return;
        settled = true;
        resolve(r);
      };
      const worker = new Worker(workerFile, { workerData: { home, force: deps.force === true } });
      worker.on("message", (m: ToMain) => {
        if (m.type === "stage") deps.onStage?.(m.stage);
        else if (m.type === "log") deps.log?.(m.message);
        else if (m.type === "result") finish(m.result);
        else finish(failed(m.message));
      });
      worker.on("error", (e) => finish(failed(e.message)));
      worker.on("exit", (code) => finish(failed(`The update stopped unexpectedly (exit ${code}). The installed data was not changed.`)));
    });
}
