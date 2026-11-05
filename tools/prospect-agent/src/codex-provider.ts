import { join } from "node:path";
import { z } from "zod";
import { ProviderUnavailableError, type ProspectAIProvider, type ProviderCapabilities, type QualifyInput } from "../../../src/lib/prospecting/providers/types";
import { SCORE_CATEGORIES, SCORE_MAX, type AnalyzedBusiness, type DiscoveryRequest, type ProviderAssessment } from "../../../src/lib/prospecting/types";
import { execStructured, KIND_MESSAGES, type FailureKind, type ProcRunner } from "./codex";
import type { Effort } from "./config";

/**
 * Qualification by Codex. Codex gets ONLY: the search settings, and for each plausible business a compact evidence bundle (name, city,
 * industry, website domain, deterministic signals, the dated observations, and whether an email/phone exists, never the address itself).
 * It does not get the CRM, prospects, emails, quotes, credentials or any page content. It does not search, browse or run commands; the
 * deterministic pipeline (discovery, website checks, duplicates, cooldown, ignored businesses) stays authoritative.
 *
 * What comes back is untrusted: it is checked against a strict schema here and then validated again by the pipeline (score caps, evidence
 * required, neutral wording) and once more by the CRM server.
 */
export const BATCH_SIZE = 6;

const categoryJson = { type: "object", additionalProperties: false, required: ["score", "reason", "observations"], properties: { score: { type: "integer", minimum: 0 }, reason: { type: "string" }, observations: { type: "array", items: { type: "string" } } } };
export const OUTPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["assessments"],
  properties: {
    assessments: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["ref", "scores", "summary", "opportunity"],
        properties: {
          ref: { type: "string" },
          scores: { type: "object", additionalProperties: false, required: [...SCORE_CATEGORIES], properties: Object.fromEntries(SCORE_CATEGORIES.map((c) => [c, categoryJson])) },
          summary: { type: "string" },
          opportunity: { type: "string" },
        },
      },
    },
  },
} as const;

const categoryZ = z.object({ score: z.number().int(), reason: z.string().max(600), observations: z.array(z.string().max(20)).max(12) });
const answerZ = z.object({
  assessments: z
    .array(
      z.object({
        ref: z.string().max(20),
        scores: z.object(Object.fromEntries(SCORE_CATEGORIES.map((c) => [c, categoryZ])) as Record<(typeof SCORE_CATEGORIES)[number], typeof categoryZ>),
        summary: z.string().max(1500),
        opportunity: z.string().max(500),
      }),
    )
    .max(BATCH_SIZE * 2),
});

export const TEST_SCHEMA = { type: "object", additionalProperties: false, required: ["ok"], properties: { ok: { type: "boolean" } } } as const;

/** The evidence bundle for one business: facts the deterministic analysis produced. Contact details are reduced to booleans. */
export function bundle(item: AnalyzedBusiness, ref: string) {
  const { business: b, analysis: a } = item;
  const domain = (() => {
    try {
      return b.websiteUrl ? new URL(b.websiteUrl).hostname.replace(/^www\./, "") : null;
    } catch {
      return null;
    }
  })();
  const s = a.signals;
  return {
    ref,
    name: b.companyName,
    city: b.city,
    industry: b.industry,
    website: domain,
    hasEmail: Boolean(b.email ?? a.contact.email),
    hasPhone: Boolean(b.phone ?? a.contact.phone),
    signals: { reachable: s.reachable, https: s.https, mobileViewport: s.hasMobileViewport, contactPage: s.contactPageFound, callToAction: s.ctaFound, booking: s.bookingFlowFound, quoteOrForm: s.quoteFlowFound || s.formFound, portfolio: s.portfolioFound, socialOnly: s.socialOnly, footerYear: s.copyrightYear, legacyMarkup: s.legacyMarkup, cms: s.cms, pagesChecked: s.pagesChecked },
    observations: a.observations.map((o) => ({ id: o.id, fact: o.fact })),
  };
}

export function buildPrompt(request: DiscoveryRequest, items: AnalyzedBusiness[]): string {
  const businesses = items.map((it, i) => bundle(it, `b${i + 1}`));
  const modeHint: Record<string, string> = {
    no_website: "Prioritise businesses without a proper standalone website.",
    redesign: "Prioritise businesses whose current website shows clear, observed weaknesses.",
    web_app: "Prioritise businesses where a custom web application, booking, quote flow or internal tool could plausibly add value.",
    industry: `The search is a hunt in one industry (${request.industry ?? "unspecified"}).`,
    quick: "A quick, light assessment is enough.",
    deep: "Assess each business thoroughly.",
  };
  return [
    "You assess local businesses as possible clients for a freelance web developer who builds websites, quote and booking flows, and small web applications.",
    "This is a data task. Do NOT run commands, browse, search, read files or change anything. Use ONLY the data below.",
    "",
    "Rules:",
    "- Base every claim on the listed observations or signals. Cite supporting observation ids in `observations` for each category. If there is no evidence, give 0 points for website_need and conversion_gap.",
    "- Use neutral, professional wording (for example 'modernisation opportunity', 'limited conversion flow'). Never insult a business; no opinions on taste.",
    "- Do not invent facts about the business, prices, or needs. Do not mention anything not in the data.",
    `- Category maximums: ${SCORE_CATEGORIES.map((c) => `${c} ${SCORE_MAX[c]}`).join(", ")}. Give contactability 0 (it is computed elsewhere).`,
    "- `opportunity` is a short suggested service (for example 'Website redesign + quote request flow'). `summary` is one or two neutral sentences.",
    "- Return one assessment per business, using its `ref`. Answer with JSON matching the provided schema and nothing else.",
    "",
    `Search: mode=${request.mode}; location=${request.location}; industry=${request.industry ?? "any"}; minimum score=${request.threshold}. ${modeHint[request.mode] ?? ""}`,
    "",
    "Businesses (JSON):",
    JSON.stringify(businesses),
  ].join("\n");
}

export type ProviderStats = { calls: number; okCalls: number; ms: number; lastFailure: FailureKind | null; notes: string[] };

export type CodexProviderOptions = { bin: string; model: string | null; effort: Effort; timeoutMs: number; dir: string; flags: ReadonlySet<string>; run?: ProcRunner; signal?: AbortSignal; onLog?: (msg: string, fields?: Record<string, unknown>) => void };

export class CodexProvider implements ProspectAIProvider {
  readonly id = "local_codex" as const;
  readonly stats: ProviderStats = { calls: 0, okCalls: 0, ms: 0, lastFailure: null, notes: [] };
  constructor(private readonly o: CodexProviderOptions) {}

  async capabilities(): Promise<ProviderCapabilities> {
    return { id: "local_codex" as const, available: true, supportsWebSearch: false, synthetic: false, reason: null };
  }

  async qualifyBusinesses({ request, items }: QualifyInput): Promise<ProviderAssessment[]> {
    const out: ProviderAssessment[] = [];
    for (let i = 0; i < items.length; i += BATCH_SIZE) {
      if (this.o.signal?.aborted) break; // the agent was stopped: keep what was assessed so far
      const batch = items.slice(i, i + BATCH_SIZE);
      const n = ++this.stats.calls;
      const res = await execStructured({ bin: this.o.bin, dir: join(this.o.dir, `call-${n}`), prompt: buildPrompt(request, batch), schema: OUTPUT_SCHEMA as unknown as Record<string, unknown>, model: this.o.model, effort: this.o.effort, timeoutMs: this.o.timeoutMs, flags: this.o.flags, run: this.o.run, signal: this.o.signal });
      this.stats.ms += res.ms;
      if (!res.ok && res.aborted) {
        this.stats.calls--; // a call that was cut short by Stop is not a Codex problem and is not counted
        break;
      }
      this.o.onLog?.("codex call", { call: n, ok: res.ok, exit: res.ok ? res.exitCode : res.exitCode, ms: res.ms, ...(res.ok ? {} : { kind: res.kind }) });
      if (!res.ok) {
        this.stats.lastFailure = res.kind;
        // A bad answer for one batch is skipped; anything that means Codex itself cannot work stops the run (and keeps what was found).
        if (res.kind === "invalid_output" || res.kind === "agent_error") {
          this.stats.notes.push(`${batch.length} business${batch.length === 1 ? "" : "es"} skipped: ${KIND_MESSAGES[res.kind]}`);
          continue;
        }
        throw new ProviderUnavailableError(res.message, res.kind === "codex_usage_limit" ? "usage_limit" : "failed", res.kind);
      }
      const parsed = answerZ.safeParse(res.value);
      if (!parsed.success) {
        this.stats.lastFailure = "invalid_output";
        this.stats.notes.push(`${batch.length} business${batch.length === 1 ? "" : "es"} skipped: ${KIND_MESSAGES.invalid_output}`);
        continue;
      }
      this.stats.okCalls++;
      for (const a of parsed.data.assessments) {
        const idx = Number(/^b(\d+)$/.exec(a.ref)?.[1]) - 1;
        const item = batch[idx];
        if (!item) continue;
        out.push({ companyName: item.business.companyName, websiteUrl: item.business.websiteUrl, scores: a.scores, summary: a.summary, opportunity: a.opportunity });
      }
    }
    return out;
  }
}
