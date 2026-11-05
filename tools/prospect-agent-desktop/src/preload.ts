import { contextBridge, ipcRenderer } from "electron";
import { CH, type RendererApi, type View } from "./ipc";

/** The window's only door to the app: a fixed list of actions. No Node, no file access, no arbitrary URLs. */
const api: RendererApi = {
  getView: () => ipcRenderer.invoke(CH.getView),
  onView: (cb) => {
    const listener = (_e: unknown, view: View) => cb(view);
    ipcRenderer.on(CH.view, listener);
    return () => ipcRenderer.removeListener(CH.view, listener);
  },
  start: () => ipcRenderer.invoke(CH.start),
  stop: (force) => ipcRenderer.invoke(CH.stop, force === true),
  testCodex: () => ipcRenderer.invoke(CH.testCodex),
  openCodexLogin: () => ipcRenderer.invoke(CH.codexLogin),
  updateData: (force) => ipcRenderer.invoke(CH.updateData, force === true),
  openCrm: (page) => ipcRenderer.invoke(CH.openCrm, page),
  copyDiagnostics: () => ipcRenderer.invoke(CH.copyDiagnostics),
  openLogs: () => ipcRenderer.invoke(CH.openLogs),
  setSetting: (key, value) => ipcRenderer.invoke(CH.setSetting, key, value),
  hide: () => ipcRenderer.invoke(CH.hide),
};

contextBridge.exposeInMainWorld("agent", api);
