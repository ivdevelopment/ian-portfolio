import { ProviderUnavailableError, type ProspectAIProvider, type ProviderCapabilities, type QualifyInput } from "./types";

/**
 * Boundary for the FUTURE official "Sign in with ChatGPT" plan-usage integration. In P10 it is intentionally not connectable: it reports why and
 * refuses to run, so no request can ever be made, billable or otherwise.
 *
 * Verified against OpenAI's developer documentation (developers.openai.com/siwc, read 5 Nov 2026):
 *   - ChatGPT plan usage is documented for open-source and locally hosted apps. For "a paid or remotely hosted app" the docs say to complete
 *     OpenAI's interest form; they describe it as available to "selected private clients", with no self-serve approval and no published criteria.
 *   - A hosted app needs a registered OAuth client (an `oaiapp_` client ID) with an exact registered callback URL per environment.
 *   - It would use OpenID Connect with PKCE (S256) against https://auth.openai.com and, for plan usage, the scopes below, with the resource
 *     https://api.openai.com/v1. Identity scopes alone grant nothing for inference.
 *   - Requests are Responses API calls with `store: false` and `stream: true`; temperature, max_output_tokens, metadata, file search, code
 *     interpreter and hosted MCP are not accepted. Web search is neither listed as supported nor as forbidden: "subject to model and account policy".
 *   - Access tokens last one hour; refresh tokens 30 days, rotating. Tokens must never reach browser JavaScript or logs.
 *   - A usage limit surfaces as HTTP 429 `subscription_sharing_usage_limit_exceeded`; OpenAI does not fall back to another billing path.
 *   - Plan usage does not grant access to ChatGPT conversations (memories and files are not mentioned and are out of scope here as well).
 *
 * None of this is implemented: connecting would need OpenAI to approve this app first. The constants only document the contract.
 */
export const CHATGPT_PLAN_CONTRACT = {
  issuer: "https://auth.openai.com",
  discovery: "https://auth.openai.com/.well-known/openid-configuration",
  scopes: ["openid", "profile", "email", "offline_access", "resource.invoke", "chatgpt.tokens.use.direct"],
  resource: "https://api.openai.com/v1",
  responses: { store: false, stream: true },
  accessTokenSeconds: 3600,
  refreshTokenDays: 30,
  usageLimitError: "subscription_sharing_usage_limit_exceeded",
} as const;

export const CHATGPT_PLAN_BLOCKER =
  "ChatGPT plan usage for a remotely hosted app needs OpenAI to approve this app as a selected private client (interest form, no self-serve route). Until then the Prospect Finder cannot run AI qualification.";

export class ChatGPTPlanProvider implements ProspectAIProvider {
  readonly id = "chatgpt_plan" as const;

  async capabilities(): Promise<ProviderCapabilities> {
    return { id: this.id, available: false, supportsWebSearch: false, synthetic: false, reason: CHATGPT_PLAN_BLOCKER };
  }

  async qualifyBusinesses(_input: QualifyInput): Promise<never> {
    void _input;
    throw new ProviderUnavailableError(CHATGPT_PLAN_BLOCKER);
  }
}
