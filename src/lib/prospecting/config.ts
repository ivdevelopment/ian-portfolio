import { ChatGPTPlanProvider, CHATGPT_PLAN_BLOCKER } from "./providers/chatgpt-plan";
import { MockBusinessSource, MockProvider } from "./providers/mock";
import type { BusinessSource, ProspectAIProvider } from "./providers/types";

/**
 * Which AI provider the Prospect Finder uses, from ONE explicit flag:
 *
 *   AI_PROSPECTING_PROVIDER = disabled | mock | local_codex | chatgpt_plan     (default and fallback for anything else: disabled)
 *
 * local_codex: the CRM only QUEUES a run; the inference is done on Ian's own PC by Codex CLI (signed in with ChatGPT), never on this server.
 *   Setting it makes the queue UI available; a run still needs the agent to be online. No credential of any kind is held here.
 *
 * There is no fallback chain. If the chosen provider is not available, the Finder stops there: it never switches to another provider and never
 * to a billable API. No OpenAI API key is read anywhere in this feature.
 */
export type ProviderFlag = "disabled" | "mock" | "local_codex" | "chatgpt_plan";

export type ProviderStatus = {
  flag: ProviderFlag;
  /** The Find button may be shown and a run may start. */
  ready: boolean;
  label: string;
  message: string;
  /** The exact reason the real integration cannot be switched on yet, when that is the situation. */
  blocker: string | null;
  synthetic: boolean;
  /** True when a run is queued for the local agent instead of being executed by this server. */
  queued: boolean;
};

type Env = Record<string, string | undefined>;

export function providerFlag(env: Env = process.env): ProviderFlag {
  const raw = (env.AI_PROSPECTING_PROVIDER ?? "").trim().toLowerCase();
  return raw === "mock" || raw === "chatgpt_plan" || raw === "local_codex" ? raw : "disabled";
}

const isLoopbackDb = (env: Env) => /^https?:\/\/(127\.0\.0\.1|localhost)(:|\/|$)/.test(env.NEXT_PUBLIC_SUPABASE_URL ?? "");

/** The mock invents businesses, so it only runs outside production or against a local database, never against the hosted one. */
export function mockAllowed(env: Env = process.env): boolean {
  return env.NODE_ENV !== "production" || isLoopbackDb(env);
}

/** What the page needs to know about the local agent to decide whether a search can start (see agent/service.ts). */
export type AgentAvailability = { name: string; online: boolean; codexState: "ready" | "not_installed" | "not_authenticated" | "error" | null } | null;

export const AGENT_OFFLINE_MESSAGE = "Local AI agent is offline. Start Ian Prospect Agent on your PC.";

/**
 * The state of AI prospecting. For `local_codex` it also depends on the agent: a search can start only while a registered agent is online and
 * its Codex is usable. The page never offers a Find button that cannot be answered.
 */
export function getProviderStatus(env: Env = process.env, agent: AgentAvailability = null): ProviderStatus {
  const flag = providerFlag(env);
  const base = { flag, synthetic: false, queued: false, blocker: null } as const;
  if (flag === "mock") {
    if (!mockAllowed(env)) {
      return { ...base, ready: false, label: "Sample data blocked", message: "The development sample provider is switched on, but it is only allowed against a local database. Nothing was run." };
    }
    return { ...base, ready: true, synthetic: true, label: "Sample data (development)", message: "Results are invented sample businesses for development and testing. They are not real." };
  }
  if (flag === "local_codex") {
    const queued = { ...base, queued: true } as const;
    if (!agent) return { ...queued, ready: false, label: "Local AI agent: not set up", message: "No local agent is registered yet. Set one up in Settings, then start Ian Prospect Agent on your PC." };
    if (!agent.online) return { ...queued, ready: false, label: `Local AI agent: ${agent.name} offline`, message: AGENT_OFFLINE_MESSAGE };
    if (agent.codexState !== "ready") {
      const why = agent.codexState === "not_installed" ? "Codex CLI is not installed on that PC." : agent.codexState === "not_authenticated" ? "Codex CLI is not signed in with ChatGPT on that PC." : "Codex CLI reported a problem on that PC.";
      return { ...queued, ready: false, label: `Local AI agent: ${agent.name} needs attention`, message: `${agent.name} is connected, but ${why}` };
    }
    return { ...queued, ready: true, label: `Local AI agent: ${agent.name} connected`, message: "Searches run on your PC with Codex, using your ChatGPT plan. Nothing is sent from this server to OpenAI." };
  }
  if (flag === "chatgpt_plan") {
    return { ...base, ready: false, label: "ChatGPT plan: waiting for approval", blocker: CHATGPT_PLAN_BLOCKER, message: "The Prospect Finder is ready, but ChatGPT plan usage requires an approved Sign in with ChatGPT integration." };
  }
  return { ...base, ready: false, label: "AI prospecting is not connected", blocker: CHATGPT_PLAN_BLOCKER, message: "AI prospecting is not connected yet. The Prospect Finder is ready, but ChatGPT plan usage requires an approved Sign in with ChatGPT integration." };
}

/** The provider to run, or null when none may run. */
export function getProvider(env: Env = process.env): ProspectAIProvider | null {
  const flag = providerFlag(env);
  if (flag === "mock") return mockAllowed(env) ? new MockProvider() : null;
  if (flag === "chatgpt_plan") return new ChatGPTPlanProvider();
  return null;
}

/** The public source to use when the provider cannot search the web itself. None is built in P10 except the development sample. */
export function getBusinessSource(env: Env = process.env): BusinessSource | null {
  return providerFlag(env) === "mock" && mockAllowed(env) ? new MockBusinessSource() : null;
}
