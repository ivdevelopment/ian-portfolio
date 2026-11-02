"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { addProspectCandidateAction, ignoreProspectCandidateAction } from "@/app/(admin)/admin/(panel)/settings/integrations/actions";
import { NETWORK_ERROR } from "@/components/admin/use-action-runner";
import { adminInput } from "@/components/admin/ui";
import { Button } from "@/components/ui/button";
import { useAppPaths } from "@/lib/crm/paths-context";
import type { CandidateView } from "@/lib/mail/zoho/candidate-service";
import { formatBrusselsDateTime } from "@/lib/preview/access-activity";
import { usePendingAction } from "@/lib/use-pending-action";

type Outcome = { id: string; text: string; href?: string; linkLabel?: string };

const BASIS_HINT = {
  header: "From the recipient's name in the email. Edit it if it is a person, not a company.",
  domain: "Guessed from the email domain. Edit it if it is wrong.",
  address: "No name found: the email address is used. Edit it before adding.",
} as const;

const RELATED_REASON = { "same email address": "same address", "same email domain": "same email domain", "website matches": "same website" } as const;

/**
 * Outgoing mail to an address no prospect has, found by "Sync now". These are CANDIDATES, not prospects: nothing becomes a
 * prospect until "Add as prospect" is pressed, and "Ignore" makes sure the address is never proposed again.
 */
export function ProspectCandidates({ items }: { items: CandidateView[] }) {
  const [outcomes, setOutcomes] = useState<Outcome[]>([]);
  const remember = (o: Outcome) => setOutcomes((all) => [o, ...all.filter((x) => x.id !== o.id)]);

  return (
    <div id="prospect-candidates" className="scroll-mt-20">
      <h3 className="text-sm font-medium">Prospect candidates</h3>
      <p className="mt-1 text-sm text-muted">Emails you sent to addresses that are not a prospect yet. Nothing is created until you add one.</p>
      <div aria-live="polite" className="mt-2 space-y-1">
        {outcomes.map((o) => (
          <p key={o.id} className="text-sm text-muted">
            {o.text}{" "}
            {o.href && (
              <Link href={o.href} className="text-accent underline-offset-4 hover:underline">
                {o.linkLabel}
              </Link>
            )}
          </p>
        ))}
      </div>
      {items.length === 0 ? (
        <p className="mt-3 text-sm text-subtle">No candidates waiting. They appear here after a sync finds outgoing mail to a new address.</p>
      ) : (
        <ul className="mt-3 divide-y divide-line rounded-card border border-line" aria-label="Prospect candidates">
          {items.map((c) => (
            <CandidateRow key={c.id} item={c} onDone={remember} />
          ))}
        </ul>
      )}
    </div>
  );
}

function CandidateRow({ item, onDone }: { item: CandidateView; onDone: (o: Outcome) => void }) {
  const router = useRouter();
  const P = useAppPaths();
  const nameId = useId();
  const { pending, run } = usePendingAction();
  const [active, setActive] = useState<"add" | "ignore" | null>(null);
  const [name, setName] = useState(item.suggestedName.value);
  const [error, setError] = useState<string | null>(null);

  const decide = (kind: "add" | "ignore") =>
    run(async () => {
      setActive(kind);
      setError(null);
      try {
        const result = kind === "add" ? await addProspectCandidateAction(item.id, name) : await ignoreProspectCandidateAction(item.id);
        if (!result.ok) return setError(result.error);
        if (kind === "add" && result.prospectId) {
          onDone({
            id: item.id,
            text: `${result.existing ? "Linked to the existing prospect" : "Added as prospect"}: ${result.company || item.address}.`,
            href: P.prospect(result.prospectId),
            linkLabel: "Open prospect",
          });
        } else onDone({ id: item.id, text: `Ignored ${item.address}. It will not be proposed again.` });
        router.refresh();
      } catch {
        setError(NETWORK_ERROR);
      } finally {
        setActive(null);
      }
    });

  return (
    <li className="space-y-3 p-3" aria-busy={pending}>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <p className="min-w-0 break-all text-sm font-medium">{item.address}</p>
        <span className="text-xs text-subtle">Outgoing</span>
      </div>
      <dl className="grid gap-x-6 gap-y-1 text-xs text-muted sm:grid-cols-[auto_1fr]">
        <dt className="text-subtle">Subject</dt>
        <dd className="break-words">{item.subject ?? "(no subject)"}</dd>
        <dt className="text-subtle">{item.messageCount > 1 ? "First sent" : "Sent"}</dt>
        <dd>{formatBrusselsDateTime(item.firstAt)}</dd>
        {item.messageCount > 1 && (
          <>
            <dt className="text-subtle">Messages</dt>
            <dd>
              {item.messageCount}, latest {formatBrusselsDateTime(item.lastAt)}
            </dd>
          </>
        )}
        <dt className="text-subtle">Why shown</dt>
        <dd>{item.why}</dd>
        {item.related.length > 0 && (
          <>
            <dt className="text-subtle">Existing</dt>
            <dd>
              {item.related.map((r, i) => (
                <span key={r.id}>
                  {i > 0 && ", "}
                  <Link href={P.prospect(r.id)} className="text-ink underline underline-offset-4">
                    {r.company}
                  </Link>{" "}
                  ({RELATED_REASON[r.reason]})
                </span>
              ))}
            </dd>
          </>
        )}
      </dl>
      <div>
        <label htmlFor={nameId} className="block text-xs text-subtle">
          Company name
        </label>
        <input id={nameId} value={name} maxLength={200} onChange={(e) => setName(e.target.value)} disabled={pending} className={`${adminInput} mt-1 h-9 max-w-md`} />
        <p className="mt-1 text-xs text-subtle">{BASIS_HINT[item.suggestedName.basis]}</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" icon="none" pending={active === "add"} pendingLabel="Adding…" disabled={pending || !name.trim()} onClick={() => void decide("add")}>
          Add as prospect
        </Button>
        <Button size="sm" variant="secondary" icon="none" pending={active === "ignore"} pendingLabel="Ignoring…" disabled={pending} onClick={() => void decide("ignore")}>
          Ignore
        </Button>
      </div>
      {error && (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      )}
    </li>
  );
}
