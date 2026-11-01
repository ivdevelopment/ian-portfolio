"use client";

import { useAppPaths } from "@/lib/crm/paths-context";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useMemo, useRef, useState, useTransition } from "react";
import { CalendarClock, Eye, EyeOff, GripVertical, MoreHorizontal, StickyNote } from "lucide-react";
import { addActivityAction, setFollowUpAction, setStatusAction } from "@/app/(admin)/admin/(panel)/prospects/actions";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/loading";
import { PRIORITY_LABELS, PRIORITY_TONES, PROSPECT_STATUSES, STATUS_LABELS, type ProspectStatus } from "@/lib/prospects/constants";
import { BOARD_DEFAULT_COLUMNS, cardFollowUp, groupBoard, applyOverrides, type BoardCard } from "@/lib/prospects/board";
import { FOLLOW_UP_PRESETS, addDays, formatDay } from "@/lib/prospects/dates";
import { rememberPreference } from "@/lib/prospects/preference-cookie";
import { formatEur } from "@/lib/prospects/money";
import { cn } from "@/lib/utils";
import { ConfirmDialog } from "./confirm-dialog";
import { NETWORK_ERROR } from "./use-action-runner";
import { Field } from "./form-bits";
import { Badge, EmptyState, adminInput } from "./ui";

const COLUMNS_COOKIE = "prospect_board_columns";

type Props = {
  cards: BoardCard[];
  today: string;
  /** Statuses shown as columns (from the saved preference, defaults otherwise). */
  visible: ProspectStatus[];
  total: number;
  truncated: boolean;
  /** Where previews live, e.g. ianverlinden.com. */
  baseDomain: string;
};

/**
 * The sales pipeline as columns. Columns ARE the existing prospect statuses: dropping a card calls the same
 * server action as every other status change, so the normal activity is written and authorisation applies.
 * Drag and drop is a convenience; every card also has a keyboard "Move to…" menu, and below 768px the board is a
 * status selector with one column at a time.
 */
export function ProspectBoard({ cards: serverCards, today, visible: initialVisible, total, truncated, baseDomain }: Props) {
  const P = useAppPaths();
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [overrides, setOverrides] = useState<Record<string, ProspectStatus>>({});
  // Cards whose move is still being saved: they show a small spinner and cannot be moved again until it settles.
  const [saving, setSaving] = useState<Set<string>>(() => new Set());
  const [seen, setSeen] = useState(serverCards);
  const [visible, setVisible] = useState<ProspectStatus[]>(initialVisible);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overStatus, setOverStatus] = useState<ProspectStatus | null>(null);
  const [announce, setAnnounce] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<{ kind: "followup" | "note"; card: BoardCard } | null>(null);

  // New server data replaces optimistic state (set during render, the supported "reset on prop change" pattern).
  if (seen !== serverCards) {
    setSeen(serverCards);
    setOverrides({});
  }

  const cards = useMemo(() => applyOverrides(serverCards, overrides), [serverCards, overrides]);
  const columns = useMemo(() => groupBoard(cards, today), [cards, today]);
  const shown = PROSPECT_STATUSES.filter((s) => visible.includes(s));

  const firstWithCards = shown.find((s) => columns[s].count > 0) ?? shown[0];
  const [activeTab, setActiveTab] = useState<ProspectStatus>(firstWithCards);
  const active = shown.includes(activeTab) ? activeTab : shown[0];

  const saveVisible = (next: ProspectStatus[]) => {
    setVisible(next);
    rememberPreference(COLUMNS_COOKIE, next.join(","), P.kind === "crm" ? "/" : "/admin");
  };

  const move = (id: string, to: ProspectStatus) => {
    const card = cards.find((c) => c.id === id);
    if (!card || card.status === to || saving.has(id)) return;
    const from = card.status;
    setError(null);
    setSaving((set) => new Set(set).add(id));
    setOverrides((o) => ({ ...o, [id]: to }));
    setAnnounce(`Moved ${card.company_name} to ${STATUS_LABELS[to]}.`);
    startTransition(async () => {
      // A dropped connection throws instead of returning a result: treat it like any failed save.
      const result = await setStatusAction(id, to).catch(() => ({ ok: false as const, error: "The connection was lost." }));
      setSaving((set) => {
        const next = new Set(set);
        next.delete(id);
        return next;
      });
      if (!result.ok) {
        // Roll back: with no override the card is exactly where the database still has it.
        setOverrides((o) => {
          const next = { ...o };
          delete next[id];
          return next;
        });
        setError(`${card.company_name} could not be moved: ${result.error}`);
        setAnnounce(`Could not move ${card.company_name}. It is back in ${STATUS_LABELS[from]}.`);
        return;
      }
      router.refresh();
    });
  };

  const hiddenCounts = PROSPECT_STATUSES.filter((s) => !visible.includes(s));
  const toggleColumn = (s: ProspectStatus) => saveVisible(visible.includes(s) ? visible.filter((v) => v !== s) : [...visible, s]);

  return (
    <div>
      <p className="sr-only" role="status" aria-live="polite">
        {announce}
      </p>
      {error && (
        <p role="alert" className="mb-3 rounded-card border border-danger/40 bg-danger/10 p-3 text-sm text-danger">
          {error}
        </p>
      )}
      {truncated && (
        <p className="mb-3 text-xs text-subtle">
          Showing the first {cards.length} of {total} prospects. Narrow the filters to see the rest.
        </p>
      )}

      {/* Columns that are not shown by default */}
      <details className="mb-3 rounded-card border border-line bg-glass px-3 py-2 text-sm">
        <summary className="cursor-pointer text-muted">
          More columns
          {hiddenCounts.some((s) => columns[s].count > 0) && (
            <span className="ml-2 text-xs text-amber-200">
              {hiddenCounts.filter((s) => columns[s].count > 0).map((s) => `${STATUS_LABELS[s]} ${columns[s].count}`).join(" · ")} hidden
            </span>
          )}
        </summary>
        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2">
          {PROSPECT_STATUSES.map((s) => (
            <label key={s} className="flex cursor-pointer items-center gap-2 text-muted">
              <input type="checkbox" className="size-4 accent-[var(--color-accent-strong)]" checked={visible.includes(s)} onChange={() => toggleColumn(s)} />
              {STATUS_LABELS[s]} <span className="text-xs text-subtle">{columns[s].count}</span>
            </label>
          ))}
          <button
            type="button"
            className="text-xs text-accent hover:underline"
            onClick={() => saveVisible([...BOARD_DEFAULT_COLUMNS])}
          >
            Reset to the default pipeline
          </button>
        </div>
      </details>

      {/* Narrow screens: one column at a time */}
      <div role="tablist" aria-label="Pipeline stage" className="mb-3 flex gap-2 overflow-x-auto pb-1 md:hidden">
        {shown.map((s) => (
          <button
            key={s}
            role="tab"
            type="button"
            aria-selected={active === s}
            onClick={() => setActiveTab(s)}
            className={cn(
              "shrink-0 rounded-full border px-3 py-1.5 text-sm whitespace-nowrap",
              active === s ? "border-accent bg-accent-soft text-ink" : "border-line text-muted",
            )}
          >
            {STATUS_LABELS[s]} <span className="tabular-nums text-xs">{columns[s].count}</span>
          </button>
        ))}
      </div>

      {shown.length === 0 ? (
        <EmptyState>No columns selected. Open “More columns” to choose some.</EmptyState>
      ) : (
        <div className="flex gap-3 overflow-x-auto pb-3 md:items-start" data-testid="board">
          {shown.map((s) => {
            const column = columns[s];
            return (
              <section
                key={s}
                aria-label={`${STATUS_LABELS[s]}, ${column.count} prospects`}
                onDragOver={(e) => {
                  if (!dragId) return;
                  e.preventDefault();
                  e.dataTransfer.dropEffect = "move";
                  setOverStatus(s);
                }}
                onDragLeave={() => setOverStatus((o) => (o === s ? null : o))}
                onDrop={(e) => {
                  e.preventDefault();
                  const id = e.dataTransfer.getData("text/plain") || dragId;
                  setOverStatus(null);
                  setDragId(null);
                  if (id) move(id, s);
                }}
                className={cn(
                  "w-full shrink-0 flex-col rounded-card border bg-glass p-2.5 md:flex md:w-72",
                  active === s ? "flex" : "hidden",
                  overStatus === s ? "border-accent bg-accent-soft/40" : "border-line",
                )}
              >
                <header className="mb-2 flex items-baseline justify-between gap-2 px-1">
                  <h2 className="text-sm font-medium">{STATUS_LABELS[s]}</h2>
                  <p className="text-xs text-muted tabular-nums">
                    <span className="text-ink">{column.count}</span>
                    {column.value !== null && (
                      <span title={`${column.withValue} of ${column.count} have an estimate`}> · {formatEur(column.value)}</span>
                    )}
                  </p>
                </header>
                {column.cards.length === 0 ? (
                  <p className="rounded-md border border-dashed border-line px-3 py-6 text-center text-xs text-subtle">
                    {dragId ? "Drop here" : "No prospects"}
                  </p>
                ) : (
                  <ul className="space-y-2">
                    {column.cards.map((card) => (
                      <li key={card.id}>
                        <Card
                          card={card}
                          today={today}
                          baseDomain={baseDomain}
                          dragging={dragId === card.id}
                          saving={saving.has(card.id)}
                          onDragStart={() => setDragId(card.id)}
                          onDragEnd={() => {
                            setDragId(null);
                            setOverStatus(null);
                          }}
                          onMove={(to) => move(card.id, to)}
                          onFollowUp={() => setDialog({ kind: "followup", card })}
                          onNote={() => setDialog({ kind: "note", card })}
                        />
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            );
          })}
        </div>
      )}

      <FollowUpDialog
        key={dialog?.kind === "followup" ? dialog.card.id : "fu"}
        open={dialog?.kind === "followup"}
        card={dialog?.kind === "followup" ? dialog.card : null}
        today={today}
        onClose={() => setDialog(null)}
        onDone={() => {
          setDialog(null);
          router.refresh();
        }}
      />
      <NoteDialog
        key={dialog?.kind === "note" ? dialog.card.id : "note"}
        open={dialog?.kind === "note"}
        card={dialog?.kind === "note" ? dialog.card : null}
        onClose={() => setDialog(null)}
        onDone={() => {
          setDialog(null);
          router.refresh();
        }}
      />
    </div>
  );
}

function Card({
  card,
  today,
  baseDomain,
  dragging,
  saving,
  onDragStart,
  onDragEnd,
  onMove,
  onFollowUp,
  onNote,
}: {
  card: BoardCard;
  today: string;
  baseDomain: string;
  dragging: boolean;
  /** This card's move is being saved. */
  saving: boolean;
  onDragStart: () => void;
  onDragEnd: () => void;
  onMove: (to: ProspectStatus) => void;
  onFollowUp: () => void;
  onNote: () => void;
}) {
  const P = useAppPaths();
  const followUp = cardFollowUp(card.next_follow_up_on, today);
  const overdue = followUp?.state.kind === "overdue";
  const closed = card.status === "won" || card.status === "lost" || card.status === "not_interested" || card.status === "no_response";

  return (
    <article
      draggable={!saving}
      aria-busy={saving || undefined}
      onDragStart={(e) => {
        e.dataTransfer.setData("text/plain", card.id);
        e.dataTransfer.effectAllowed = "move";
        onDragStart();
      }}
      onDragEnd={onDragEnd}
      className={cn(
        "group rounded-md border bg-elevated/60 p-2.5 text-sm transition-opacity",
        overdue && !closed ? "border-danger/50" : "border-line hover:border-line-strong",
        dragging && "opacity-40",
        saving && "border-accent/40",
      )}
    >
      <div className="flex items-start gap-1.5">
        <GripVertical aria-hidden className="mt-0.5 hidden size-4 shrink-0 cursor-grab text-subtle md:block" />
        <div className="min-w-0 flex-1">
          <Link href={P.prospect(card.id)} className="block truncate font-medium hover:text-accent" draggable={false}>
            {card.company_name}
          </Link>
          {(card.sector || card.city) && <p className="truncate text-xs text-subtle">{[card.sector, card.city].filter(Boolean).join(" · ")}</p>}
        </div>
        {saving && (
          <span role="status" className="mt-0.5 text-muted">
            <Spinner className="size-3.5" />
            <span className="sr-only">Saving move…</span>
          </span>
        )}
        <CardMenu card={card} baseDomain={baseDomain} onMove={onMove} onFollowUp={onFollowUp} onNote={onNote} />
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
        {followUp && !closed && (
          <span
            className={cn("inline-flex items-center gap-1", overdue ? "font-medium text-danger" : followUp.state.kind === "today" ? "text-amber-200" : "text-muted")}
            title={`Next follow-up ${formatDay(card.next_follow_up_on)}`}
          >
            <CalendarClock aria-hidden className="size-3.5" />
            {followUp.text}
          </span>
        )}
        {card.estimated_value_eur !== null && <span className="text-muted tabular-nums">{formatEur(card.estimated_value_eur)}</span>}
        {card.priority !== "normal" && <Badge tone={PRIORITY_TONES[card.priority]}>{PRIORITY_LABELS[card.priority]}</Badge>}
        {card.preview && (
          <span className={cn("inline-flex items-center gap-1", card.preview.viewed ? "text-emerald-200" : "text-subtle")}>
            {card.preview.viewed ? <Eye aria-hidden className="size-3.5" /> : <EyeOff aria-hidden className="size-3.5" />}
            {card.preview.viewed ? "Preview viewed" : "Not viewed yet"}
          </span>
        )}
      </div>
    </article>
  );
}

/** Keyboard-operable actions for one card. Esc closes, ↑/↓ move between items, Enter/Space choose. */
function CardMenu({
  card,
  baseDomain,
  onMove,
  onFollowUp,
  onNote,
}: {
  card: BoardCard;
  baseDomain: string;
  onMove: (to: ProspectStatus) => void;
  onFollowUp: () => void;
  onNote: () => void;
}) {
  const P = useAppPaths();
  const [open, setOpen] = useState(false);
  const [moving, setMoving] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menuId = useId();

  const close = (restoreFocus = true) => {
    setOpen(false);
    setMoving(false);
    if (restoreFocus) trigger.current?.focus();
  };

  useEffect(() => {
    if (!open) return;
    root.current?.querySelector<HTMLElement>('[role="menuitem"]:not([disabled])')?.focus();
    const away = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) {
        setOpen(false);
        setMoving(false);
      }
    };
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, [open, moving]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      if (moving) setMoving(false);
      else close();
      return;
    }
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp" && e.key !== "Home" && e.key !== "End") return;
    e.preventDefault();
    const items = [...(root.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled])') ?? [])];
    if (items.length === 0) return;
    const index = items.indexOf(document.activeElement as HTMLElement);
    const next = e.key === "Home" ? 0 : e.key === "End" ? items.length - 1 : (index + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
    items[next].focus();
  };

  const itemClass = "block w-full rounded px-2.5 py-1.5 text-left text-sm hover:bg-glass-strong focus-visible:bg-glass-strong focus-visible:outline-none disabled:opacity-40";

  return (
    <div ref={root} className="relative" onKeyDown={onKeyDown}>
      <button
        ref={trigger}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={`Actions for ${card.company_name}`}
        onClick={() => (open ? close(false) : setOpen(true))}
        className="inline-flex size-7 items-center justify-center rounded-md text-muted hover:bg-glass-strong hover:text-ink"
      >
        <MoreHorizontal aria-hidden className="size-4" />
      </button>
      {open && (
        <div id={menuId} role="menu" aria-label={moving ? `Move ${card.company_name} to` : `${card.company_name} actions`} className="absolute right-0 z-30 mt-1 max-h-72 w-52 overflow-auto rounded-md border border-line-strong bg-elevated p-1 shadow-lift">
          {moving ? (
            <>
              <button type="button" role="menuitem" className={cn(itemClass, "text-xs text-muted")} onClick={() => setMoving(false)}>
                ← Back
              </button>
              {PROSPECT_STATUSES.map((s) => (
                <button
                  key={s}
                  type="button"
                  role="menuitem"
                  disabled={s === card.status}
                  className={itemClass}
                  onClick={() => {
                    close();
                    onMove(s);
                  }}
                >
                  {STATUS_LABELS[s]}
                  {s === card.status && <span className="ml-1 text-xs text-subtle">(current)</span>}
                </button>
              ))}
            </>
          ) : (
            <>
              <Link role="menuitem" href={P.prospect(card.id)} className={itemClass}>
                Open
              </Link>
              <button type="button" role="menuitem" className={itemClass} onClick={() => setMoving(true)}>
                Move to…
              </button>
              <button type="button" role="menuitem" className={itemClass} onClick={() => { close(false); onFollowUp(); }}>
                Set follow-up
              </button>
              <button type="button" role="menuitem" className={itemClass} onClick={() => { close(false); onNote(); }}>
                <StickyNote aria-hidden className="mr-1.5 inline size-3.5" />
                Add note
              </button>
              {card.preview && (
                <a role="menuitem" href={`https://${card.preview.subdomain}.${baseDomain}`} target="_blank" rel="noopener noreferrer" className={itemClass}>
                  Open preview
                </a>
              )}
              {card.email && (
                <a role="menuitem" href={`mailto:${card.email}`} className={itemClass}>
                  Send email
                </a>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function FollowUpDialog({ open, card, today, onClose, onDone }: { open: boolean; card: BoardCard | null; today: string; onClose: () => void; onDone: () => void }) {
  const [custom, setCustom] = useState(card?.next_follow_up_on ?? "");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const save = (day: string | null) => {
    if (!card) return;
    setError(null);
    if (pending) return;
    startTransition(async () => {
      try {
        const result = await setFollowUpAction(card.id, day);
        if (!result.ok) return setError(result.error);
        onDone();
      } catch {
        setError(NETWORK_ERROR);
      }
    });
  };
  return (
    <ConfirmDialog open={open} title={card ? `Follow-up for ${card.company_name}` : "Follow-up"} confirmLabel="Save date" tone="primary" pending={pending} error={error} onClose={onClose} onConfirm={() => custom && save(custom)}>
      <div className="flex flex-wrap gap-2">
        {FOLLOW_UP_PRESETS.map((p) => (
          <Button key={p.id} size="sm" variant="secondary" icon="none" disabled={pending} onClick={() => save(addDays(today, p.days))}>
            {p.label}
          </Button>
        ))}
      </div>
      <Field id="board-fu" label="Custom date" className="mt-4">
        <input id="board-fu" type="date" value={custom} onChange={(e) => setCustom(e.target.value)} className={cn(adminInput, "h-10 [color-scheme:dark]")} />
      </Field>
      {card?.next_follow_up_on && (
        <Button size="sm" variant="secondary" icon="none" className="mt-4" disabled={pending} onClick={() => save(null)}>
          Clear follow-up
        </Button>
      )}
    </ConfirmDialog>
  );
}

function NoteDialog({ open, card, onClose, onDone }: { open: boolean; card: BoardCard | null; onClose: () => void; onDone: () => void }) {
  const [text, setText] = useState("");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <ConfirmDialog
      open={open}
      title={card ? `Note for ${card.company_name}` : "Note"}
      confirmLabel="Add note"
      tone="primary"
      pending={pending}
      error={error}
      onClose={onClose}
      onConfirm={() => {
        if (!card || !text.trim()) return setError("Write something first.");
        setError(null);
        if (pending) return;
        startTransition(async () => {
          try {
            const result = await addActivityAction(card.id, { type: "note", title: "Note", description: text.trim() });
            if (!result.ok) return setError(result.error);
            onDone();
          } catch {
            setError(NETWORK_ERROR);
          }
        });
      }}
    >
      <Field id="board-note" label="Note">
        <textarea id="board-note" rows={4} value={text} maxLength={5000} onChange={(e) => setText(e.target.value)} className={cn(adminInput, "py-2")} />
      </Field>
    </ConfirmDialog>
  );
}
