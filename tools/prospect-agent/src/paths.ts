import { homedir } from "node:os";
import { join } from "node:path";

/** Everything the agent keeps lives here, outside any repository: config, the protected token, logs and per-run scratch folders. */
export function agentHome(env: NodeJS.ProcessEnv = process.env): string {
  return env.PROSPECT_AGENT_HOME || (env.LOCALAPPDATA ? join(env.LOCALAPPDATA, "IanProspectAgent") : join(homedir(), ".ian-prospect-agent"));
}

export const runsDir = (home = agentHome()) => join(home, "runs");
export const runDir = (runId: string, home = agentHome()) => join(runsDir(home), runId.replace(/[^A-Za-z0-9-]/g, ""));
