import type { AgentSnapshot, Overall } from "../../prospect-agent/src/service";

/** What the tray menu contains for a given state. Pure data: main.ts turns it into a native menu. */
export type MenuSpec = { id?: "open" | "start" | "stop" | "crm" | "exit"; label: string; enabled?: boolean; separator?: boolean };

export function trayMenu(s: AgentSnapshot, overall: Overall): MenuSpec[] {
  const canStart = (s.worker === "stopped" || s.worker === "error") && s.setup.configured;
  const canStop = s.worker === "running";
  return [
    { label: "Ian Prospect Agent", enabled: false },
    { label: `Status: ${overall.label}`, enabled: false },
    { label: "", separator: true },
    { id: "open", label: "Open" },
    { id: "start", label: "Start Agent", enabled: canStart },
    { id: "stop", label: "Stop Agent", enabled: canStop },
    { id: "crm", label: "Open CRM" },
    { label: "", separator: true },
    { id: "exit", label: "Exit" },
  ];
}

export const trayIconName = (overall: Overall): string => `tray-${overall.level}`;
export const trayTooltip = (overall: Overall): string => `Ian Prospect Agent — ${overall.label}`.slice(0, 120);
