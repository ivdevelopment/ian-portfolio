import type { AnalyzedBusiness, DiscoveryRequest, ProviderAssessment, RawBusiness } from "../types";

/**
 * The AI execution layer, as the rest of the CRM sees it. Nothing outside src/lib/prospecting/providers knows how a provider authenticates:
 * no OAuth, no tokens, no API keys appear in this contract. A provider is either available or it says why not.
 *
 * Implementations: `mock` (development only, synthetic businesses), `chatgpt_plan` (the future official "Sign in with ChatGPT" plan-usage
 * integration; not available until OpenAI approves this app, see docs/prospect-finder.md). A normal OpenAI API-key provider is deliberately
 * NOT an implementation: the Prospect Finder never bills an API account.
 */
export type ProviderId = "mock" | "chatgpt_plan" | "local_codex";

export type ProviderCapabilities = {
  id: ProviderId;
  available: boolean;
  /** Whether the provider can search the public web itself. When false, discovery needs a separate public source. */
  supportsWebSearch: boolean;
  /** True for providers whose businesses are invented (the mock). Their candidates are marked and never presented as real. */
  synthetic: boolean;
  /** When not available: the plain reason, shown to the person. Never contains a secret. */
  reason: string | null;
};

export type QualifyInput = { request: DiscoveryRequest; items: AnalyzedBusiness[] };

export interface ProspectAIProvider {
  readonly id: ProviderId;
  capabilities(): Promise<ProviderCapabilities>;
  /** Optional: find businesses with the provider's own web search. Only called when `supportsWebSearch` is true. */
  discoverBusinesses?(request: DiscoveryRequest): Promise<RawBusiness[]>;
  /**
   * Judge compact, structured evidence (never whole pages) for a small batch of businesses. The result is a PROPOSAL: scores are capped, reasons
   * without evidence are removed and the contact score is recomputed by the pipeline (scoring.ts) before anything is stored.
   */
  qualifyBusinesses(input: QualifyInput): Promise<ProviderAssessment[]>;
}

/** Thrown when a provider cannot run (not connected, not approved, limit reached). The pipeline stops at this boundary and never falls back to another provider. */
export class ProviderUnavailableError extends Error {
  constructor(message: string, readonly code: "not_available" | "usage_limit" | "failed" = "not_available", /** A fixed, sanitised failure kind for the run record (codex_timeout, codex_usage_limit...). */ readonly failureKind: string | null = null) {
    super(message);
  }
}

/** A source of public businesses used when the provider cannot search the web by itself. No source is built in P10: see docs/prospect-finder.md. */
export interface BusinessSource {
  readonly id: string;
  discover(request: DiscoveryRequest): Promise<RawBusiness[]>;
}
