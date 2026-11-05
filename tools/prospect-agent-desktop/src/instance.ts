/**
 * One tray application per Windows user. Starting it a second time must not open a second app (and so never a second worker): the second
 * process asks the first to show its window and exits. (The worker has its own one-per-user lock as a second line of defence.)
 */
export type InstanceApp = {
  requestSingleInstanceLock(): boolean;
  on(event: "second-instance", listener: () => void): unknown;
  quit(): void;
};

/** True when this process is the first instance and should carry on; false when another is already running (this one is told to quit). */
export function claimSingleInstance(app: InstanceApp, onSecondInstance: () => void): boolean {
  if (!app.requestSingleInstanceLock()) {
    app.quit();
    return false;
  }
  app.on("second-instance", onSecondInstance);
  return true;
}
