"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { saveServicesAction, saveSkillsAction } from "@/app/admin/(panel)/pages/actions";
import { slugify, uniqueSlug } from "@/lib/slug";
import {
  SERVICE_ICONS,
  servicesListSchema,
  skillsListSchema,
  type ServiceIconId,
} from "@/lib/schemas/site-content";
import { cn } from "@/lib/utils";
import { ServiceIconBadge } from "@/components/services/service-icon";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "./confirm-dialog";
import { SaveBar, rowButton, type SaveStatus } from "./form-bits";
import { Panel, adminInput } from "./ui";

type ServiceDraft = {
  id: string;
  slug: string;
  title: string;
  description: string;
  icon: ServiceIconId;
  includesText: string;
  enabled: boolean;
};

type SkillDraft = { id: string; name: string; enabled: boolean };

function move<T>(list: T[], from: number, to: number): T[] {
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

/** Maps `"2.slug"`-style issue paths from Zod / the server onto per-item messages. */
function groupErrors(errors: Record<string, string>): Map<number, Record<string, string>> {
  const map = new Map<number, Record<string, string>>();
  for (const [path, message] of Object.entries(errors)) {
    const [index, ...rest] = path.split(".");
    const i = Number(index);
    if (Number.isNaN(i)) continue;
    map.set(i, { ...(map.get(i) ?? {}), [rest[0] ?? "_"]: message });
  }
  return map;
}

function useListSave<T>(
  build: (draft: T[]) => unknown,
  schemaParse: (value: unknown) => { success: true } | { success: false; issues: Array<{ path: PropertyKey[]; message: string }> },
  action: (value: unknown) => Promise<{ ok: true } | { ok: false; error: string; fieldErrors?: Record<string, string> }>,
) {
  const router = useRouter();
  const [status, setStatus] = useState<SaveStatus>({ kind: "idle" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [dirty, setDirty] = useState(false);

  const save = async (draft: T[]) => {
    const value = build(draft);
    const check = schemaParse(value);
    if (!check.success) {
      const next: Record<string, string> = {};
      for (const issue of check.issues) {
        const key = issue.path.join(".");
        if (key && !next[key]) next[key] = issue.message;
      }
      setErrors(next);
      setStatus({ kind: "error", message: "Please fix the highlighted fields." });
      return;
    }
    setErrors({});
    setStatus({ kind: "saving" });
    const result = await action(value);
    if (!result.ok) {
      setErrors(result.fieldErrors ?? {});
      setStatus({ kind: "error", message: result.error });
      return;
    }
    setDirty(false);
    setStatus({ kind: "saved", at: new Intl.DateTimeFormat("en-GB", { timeStyle: "short" }).format(new Date()) });
    router.refresh();
  };

  return { status, errors, dirty, setDirty, save };
}

/* -------------------------------------------------------------- services */

export function ServicesEditor({ initial }: { initial: ServiceDraft[] }) {
  const [items, setItems] = useState(initial);
  const [pendingDelete, setPendingDelete] = useState<number | null>(null);

  const { status, errors, dirty, setDirty, save } = useListSave<ServiceDraft>(
    (draft) =>
      draft.map((s) => ({
        id: s.id,
        slug: s.slug,
        title: s.title,
        description: s.description,
        icon: s.icon,
        enabled: s.enabled,
        includes: s.includesText
          .split("\n")
          .map((l) => l.trim())
          .filter(Boolean)
          .map((label) => ({ label })),
      })),
    (value) => servicesListSchema.safeParse(value) as never,
    saveServicesAction,
  );
  const byItem = groupErrors(errors);

  const update = (i: number, patch: Partial<ServiceDraft>) => {
    setItems((list) => list.map((s, idx) => (idx === i ? { ...s, ...patch } : s)));
    setDirty(true);
  };

  return (
    <>
      <div className="space-y-3">
        {items.length === 0 && <p className="rounded-card border border-line p-4 text-sm text-muted">No services yet.</p>}
        <ul className="space-y-3">
          {items.map((s, i) => {
            const e = byItem.get(i) ?? {};
            return (
              <li key={s.id}>
                <Panel>
                  <div className="flex items-start gap-3">
                    <ServiceIconBadge icon={s.icon} />
                    <div className="grid min-w-0 flex-1 gap-3 sm:grid-cols-2">
                      <div>
                        <label htmlFor={`svc-title-${i}`} className="mb-1.5 block text-xs font-medium text-muted">Title</label>
                        <input
                          id={`svc-title-${i}`}
                          value={s.title}
                          maxLength={80}
                          aria-invalid={Boolean(e.title)}
                          className={cn(adminInput, "h-10")}
                          onChange={(ev) => {
                            const title = ev.target.value;
                            // Keep the slug in step until it has been edited by hand.
                            const auto = s.slug === "" || s.slug === slugify(s.title);
                            update(i, { title, ...(auto ? { slug: slugify(title) } : {}) });
                          }}
                        />
                        {e.title && <p role="alert" className="mt-1 text-xs text-danger">{e.title}</p>}
                      </div>
                      <div>
                        <label htmlFor={`svc-slug-${i}`} className="mb-1.5 block text-xs font-medium text-muted">Slug (anchor on /services)</label>
                        <input
                          id={`svc-slug-${i}`}
                          value={s.slug}
                          maxLength={80}
                          aria-invalid={Boolean(e.slug)}
                          className={cn(adminInput, "h-10 font-mono")}
                          onChange={(ev) => update(i, { slug: ev.target.value })}
                        />
                        {e.slug && <p role="alert" className="mt-1 text-xs text-danger">{e.slug}</p>}
                      </div>
                      <div className="sm:col-span-2">
                        <label htmlFor={`svc-desc-${i}`} className="mb-1.5 block text-xs font-medium text-muted">Short description</label>
                        <input
                          id={`svc-desc-${i}`}
                          value={s.description}
                          maxLength={300}
                          aria-invalid={Boolean(e.description)}
                          className={cn(adminInput, "h-10")}
                          onChange={(ev) => update(i, { description: ev.target.value })}
                        />
                        {e.description && <p role="alert" className="mt-1 text-xs text-danger">{e.description}</p>}
                      </div>
                      <div>
                        <label htmlFor={`svc-icon-${i}`} className="mb-1.5 block text-xs font-medium text-muted">Icon</label>
                        <select
                          id={`svc-icon-${i}`}
                          value={s.icon}
                          className={cn(adminInput, "h-10")}
                          onChange={(ev) => update(i, { icon: ev.target.value as ServiceIconId })}
                        >
                          {SERVICE_ICONS.map((icon) => (
                            <option key={icon} value={icon}>
                              {icon}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="sm:col-span-2">
                        <label htmlFor={`svc-inc-${i}`} className="mb-1.5 block text-xs font-medium text-muted">What&apos;s included (one per line, max 8)</label>
                        <textarea
                          id={`svc-inc-${i}`}
                          rows={4}
                          value={s.includesText}
                          className={cn(adminInput, "py-2")}
                          onChange={(ev) => update(i, { includesText: ev.target.value })}
                        />
                        {e.includes && <p role="alert" className="mt-1 text-xs text-danger">{e.includes}</p>}
                      </div>
                    </div>
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-line pt-3">
                    <label className="mr-auto flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={s.enabled}
                        className="size-4 accent-[var(--color-accent-strong)]"
                        onChange={(ev) => update(i, { enabled: ev.target.checked })}
                      />
                      Enabled
                      <span className="text-xs text-subtle">{s.enabled ? "(visible)" : "(hidden)"}</span>
                    </label>
                    <button type="button" className={rowButton} disabled={i === 0} aria-label={`Move ${s.title || "service"} up`} onClick={() => { setItems((l) => move(l, i, i - 1)); setDirty(true); }}>
                      <ArrowUp aria-hidden className="size-3.5" />
                    </button>
                    <button type="button" className={rowButton} disabled={i === items.length - 1} aria-label={`Move ${s.title || "service"} down`} onClick={() => { setItems((l) => move(l, i, i + 1)); setDirty(true); }}>
                      <ArrowDown aria-hidden className="size-3.5" />
                    </button>
                    <button type="button" className={cn(rowButton, "hover:border-danger/50 hover:text-danger")} aria-label={`Delete ${s.title || "service"}`} onClick={() => setPendingDelete(i)}>
                      <Trash2 aria-hidden className="size-3.5" />
                    </button>
                  </div>
                </Panel>
              </li>
            );
          })}
        </ul>

        <Button
          size="sm"
          variant="secondary"
          disabled={items.length >= 12}
          onClick={() => {
            const slug = uniqueSlug("new-service", items.map((s) => s.slug));
            setItems((l) => [
              ...l,
              { id: crypto.randomUUID(), slug, title: "", description: "", icon: "design", includesText: "", enabled: true },
            ]);
            setDirty(true);
          }}
        >
          <Plus aria-hidden className="size-4" /> Add service
        </Button>
      </div>

      <SaveBar status={status} dirty={dirty} label="Save services" onSave={() => void save(items)} />

      <ConfirmDialog
        open={pendingDelete !== null}
        title={`Delete “${pendingDelete !== null ? items[pendingDelete]?.title || "this service" : ""}”?`}
        confirmLabel="Remove service"
        onClose={() => setPendingDelete(null)}
        onConfirm={() => {
          if (pendingDelete === null) return;
          setItems((l) => l.filter((_, idx) => idx !== pendingDelete));
          setDirty(true);
          setPendingDelete(null);
        }}
      >
        <p>The service is removed from this list now and deleted from the website when you save. Use “Enabled” to hide it instead.</p>
      </ConfirmDialog>
    </>
  );
}

/* ---------------------------------------------------------------- skills */

export function SkillsEditor({ initial }: { initial: SkillDraft[] }) {
  const [items, setItems] = useState(initial);
  const [draftName, setDraftName] = useState("");
  const [pendingDelete, setPendingDelete] = useState<number | null>(null);

  const { status, errors, dirty, setDirty, save } = useListSave<SkillDraft>(
    (draft) => draft.map((s) => ({ id: s.id, name: s.name, enabled: s.enabled })),
    (value) => skillsListSchema.safeParse(value) as never,
    saveSkillsAction,
  );
  const byItem = groupErrors(errors);

  const update = (i: number, patch: Partial<SkillDraft>) => {
    setItems((list) => list.map((s, idx) => (idx === i ? { ...s, ...patch } : s)));
    setDirty(true);
  };
  const add = () => {
    const name = draftName.trim();
    if (!name) return;
    setItems((l) => [...l, { id: crypto.randomUUID(), name, enabled: true }]);
    setDraftName("");
    setDirty(true);
  };

  return (
    <>
      <Panel title="Skills & technologies" description="Shown on the About page. Order here is the order shown.">
        {items.length === 0 && <p className="mb-3 text-sm text-muted">No skills yet.</p>}
        <ul className="space-y-2">
          {items.map((s, i) => (
            <li key={s.id} className="flex flex-wrap items-center gap-2">
              <div className="min-w-40 flex-1">
                <input
                  aria-label={`Skill ${i + 1} name`}
                  value={s.name}
                  maxLength={60}
                  aria-invalid={Boolean(byItem.get(i)?.name)}
                  className={cn(adminInput, "h-9")}
                  onChange={(ev) => update(i, { name: ev.target.value })}
                />
                {byItem.get(i)?.name && <p role="alert" className="mt-1 text-xs text-danger">{byItem.get(i)?.name}</p>}
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={s.enabled} className="size-4 accent-[var(--color-accent-strong)]" onChange={(ev) => update(i, { enabled: ev.target.checked })} />
                Enabled
              </label>
              <button type="button" className={rowButton} disabled={i === 0} aria-label={`Move ${s.name} up`} onClick={() => { setItems((l) => move(l, i, i - 1)); setDirty(true); }}>
                <ArrowUp aria-hidden className="size-3.5" />
              </button>
              <button type="button" className={rowButton} disabled={i === items.length - 1} aria-label={`Move ${s.name} down`} onClick={() => { setItems((l) => move(l, i, i + 1)); setDirty(true); }}>
                <ArrowDown aria-hidden className="size-3.5" />
              </button>
              <button type="button" className={cn(rowButton, "hover:border-danger/50 hover:text-danger")} aria-label={`Delete ${s.name}`} onClick={() => setPendingDelete(i)}>
                <Trash2 aria-hidden className="size-3.5" />
              </button>
            </li>
          ))}
        </ul>

        <div className="mt-4 flex gap-2">
          <input
            value={draftName}
            aria-label="New skill name"
            placeholder="Add a skill, e.g. Astro"
            maxLength={60}
            className={cn(adminInput, "h-9 flex-1")}
            onChange={(e) => setDraftName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                add();
              }
            }}
          />
          <Button size="sm" variant="secondary" onClick={add} disabled={items.length >= 40}>
            <Plus aria-hidden className="size-4" /> Add
          </Button>
        </div>
      </Panel>

      <SaveBar status={status} dirty={dirty} label="Save skills" onSave={() => void save(items)} />

      <ConfirmDialog
        open={pendingDelete !== null}
        title={`Delete “${pendingDelete !== null ? items[pendingDelete]?.name : ""}”?`}
        confirmLabel="Remove skill"
        onClose={() => setPendingDelete(null)}
        onConfirm={() => {
          if (pendingDelete === null) return;
          setItems((l) => l.filter((_, idx) => idx !== pendingDelete));
          setDirty(true);
          setPendingDelete(null);
        }}
      >
        <p>The skill is removed from this list now and deleted from the website when you save.</p>
      </ConfirmDialog>
    </>
  );
}
