/**
 * What a person sees for each sanitised failure kind. The agent reports only the kind (a fixed set); the words live here, so the CRM and the
 * agent say exactly the same thing and no raw Codex output ever reaches the page.
 */
export const FAILURE_KINDS = ["codex_not_installed", "codex_not_authenticated", "codex_usage_limit", "codex_timeout", "invalid_output", "network_error", "source_error", "business_data_missing", "agent_error"] as const;
export type FailureKind = (typeof FAILURE_KINDS)[number];

export const FAILURE_MESSAGES: Record<FailureKind, string> = {
  codex_not_installed: "Codex CLI is not installed or not on PATH.",
  codex_not_authenticated: "Codex CLI is not signed in with ChatGPT. Run codex and choose Sign in with ChatGPT.",
  codex_usage_limit: "Your current Codex/ChatGPT usage limit has been reached. Try again when your allowance resets.",
  codex_timeout: "Codex took too long and was stopped.",
  invalid_output: "Codex returned an answer that could not be used.",
  network_error: "Codex could not reach its service (network problem).",
  source_error: "The public business source (OpenStreetMap) is busy or unreachable. Try again in a few minutes.",
  business_data_missing: "Local business data is not installed on the agent PC yet. Run: npm run prospect-agent -- update-business-data",
  agent_error: "The agent stopped with an error.",
};

export function failureMessage(kind: string | null | undefined): string | null {
  return kind && (FAILURE_KINDS as readonly string[]).includes(kind) ? FAILURE_MESSAGES[kind as FailureKind] : null;
}
