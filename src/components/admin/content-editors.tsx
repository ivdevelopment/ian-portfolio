"use client";

import {
  Controller,
  FormProvider,
  useForm,
  useFormContext,
  type FieldValues,
  type UseFormReturn,
} from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  saveAboutContentAction,
  saveContactContentAction,
  saveHomeContentAction,
  saveSettingsAction,
} from "@/app/admin/(panel)/pages/actions";
import { SITE_IMAGE_MAX_BYTES, siteImagePath, type SiteImageSlot } from "@/lib/media-rules";
import {
  aboutContentSchema,
  contactContentSchema,
  homeContentSchema,
  siteSettingsSchema,
  type AboutContent,
  type ContactContent,
  type HomeContent,
  type SiteSettings,
} from "@/lib/schemas/site-content";
import { SaveBar, StatsFields, TextField, errorAt, useSaveForm } from "./form-bits";
import { ImageField } from "./image-field";
import { Panel } from "./ui";

/** A required-or-optional image with its alt text, bound to `<name>.src` / `<name>.alt`. */
function ImageWithAlt({
  name,
  label,
  slot,
  required,
}: {
  name: string;
  label: string;
  slot: SiteImageSlot;
  required?: boolean;
}) {
  const { control, formState } = useFormContext();
  return (
    <div className="space-y-3">
      <Controller
        control={control}
        name={`${name}.src`}
        render={({ field }) => (
          <ImageField
            label={label}
            value={field.value}
            onChange={(next) => field.onChange(next ?? "")}
            buildPath={(ext, id) => siteImagePath(slot, ext, id)}
            maxBytes={SITE_IMAGE_MAX_BYTES}
            allowRemove={!required}
            error={errorAt(formState.errors, `${name}.src`)}
          />
        )}
      />
      <TextField name={`${name}.alt`} label="Alt text" hint="Describe the image for screen readers (leave empty if purely decorative)." maxLength={300} />
    </div>
  );
}

function CtaFields({ prefix, label }: { prefix: string; label: string }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <TextField name={`${prefix}.label`} label={`${label} text`} maxLength={60} />
      <TextField name={`${prefix}.href`} label={`${label} link`} hint="A path like /work, or a full https:// URL." maxLength={300} />
    </div>
  );
}

function HeadlineFields({ prefix, lineHint }: { prefix: string; lineHint?: string }) {
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      <TextField name={`${prefix}.line1`} label="Headline — line 1" maxLength={80} />
      <TextField name={`${prefix}.line2`} label="Headline — line 2" hint={lineHint ?? "Optional lead-in before the highlighted phrase."} maxLength={80} />
      <TextField name={`${prefix}.accent`} label="Highlighted phrase" hint="Shown in the accent colour." maxLength={80} />
    </div>
  );
}

type AnyForm = UseFormReturn<FieldValues>;

function Shell({
  form,
  status,
  submit,
  children,
  saveLabel,
}: {
  form: AnyForm;
  status: Parameters<typeof SaveBar>[0]["status"];
  submit: () => void;
  children: React.ReactNode;
  saveLabel?: string;
}) {
  return (
    <FormProvider {...form}>
      <form onSubmit={(e) => e.preventDefault()} noValidate className="space-y-4">
        {children}
        <SaveBar status={status} dirty={form.formState.isDirty} label={saveLabel} onSave={submit} />
      </form>
    </FormProvider>
  );
}

/* ------------------------------------------------------------------ home */

export function HomeContentEditor({ initial }: { initial: HomeContent }) {
  const form = useForm<HomeContent>({
    resolver: zodResolver(homeContentSchema),
    defaultValues: initial,
    mode: "onTouched",
  });
  const { status, submit } = useSaveForm(form, saveHomeContentAction);

  return (
    <Shell form={form as unknown as AnyForm} status={status} submit={() => void submit()}>
      <Panel title="Hero" description="The first thing visitors see.">
        <div className="space-y-4">
          <TextField name="hero.badge" label="Availability label" hint="Leave empty to hide the badge." maxLength={80} />
          <HeadlineFields prefix="hero.headline" />
          <TextField name="hero.body" label="Description" multiline rows={3} maxLength={400} />
          <CtaFields prefix="hero.primaryCta" label="Primary button" />
          <CtaFields prefix="hero.secondaryCta" label="Secondary button" />
          <ImageWithAlt name="hero.image" label="Hero image" slot="hero" required />
        </div>
      </Panel>

      <Panel title="Stats" description="The strip under the hero. Order here is the order shown.">
        <StatsFields name="stats" />
      </Panel>

      <Panel title="Featured work intro" description="Heading above the featured-project carousel. The projects themselves are managed in Projects.">
        <div className="grid gap-3 sm:grid-cols-2">
          <TextField name="featured.eyebrow" label="Eyebrow" maxLength={60} />
          <TextField name="featured.heading" label="Heading" maxLength={80} />
          <TextField name="featured.body" label="Supporting text" multiline maxLength={300} className="sm:col-span-2" />
        </div>
      </Panel>

      <Panel title="Services intro" description="The services themselves are managed under Pages → Services.">
        <div className="grid gap-3 sm:grid-cols-2">
          <TextField name="services.eyebrow" label="Eyebrow" maxLength={60} />
          <TextField name="services.heading" label="Heading" maxLength={80} />
          <TextField name="services.statement" label="Statement" maxLength={200} className="sm:col-span-2" />
          <TextField name="services.body" label="Description" multiline maxLength={400} className="sm:col-span-2" />
        </div>
      </Panel>

      <Panel title="Reviews intro" description="The section only appears when at least one review is approved.">
        <div className="grid gap-3 sm:grid-cols-2">
          <TextField name="reviews.eyebrow" label="Eyebrow" maxLength={60} />
          <TextField name="reviews.heading" label="Heading" maxLength={80} />
          <TextField name="reviews.body" label="Description" multiline maxLength={300} className="sm:col-span-2" />
        </div>
      </Panel>

      <Panel title="Call to action" description="Used at the bottom of the homepage and several other pages.">
        <div className="space-y-4">
          <TextField name="cta.badge" label="Badge" maxLength={60} />
          <TextField name="cta.heading" label="Heading" maxLength={100} />
          <TextField name="cta.body" label="Description" multiline maxLength={400} />
          <CtaFields prefix="cta.primaryCta" label="Primary button" />
          <CtaFields prefix="cta.secondaryCta" label="Secondary button" />
          <ImageWithAlt name="cta.image" label="Background image" slot="cta" required />
        </div>
      </Panel>
    </Shell>
  );
}

/* ----------------------------------------------------------------- about */

export function AboutContentEditor({ initial }: { initial: AboutContent }) {
  const form = useForm<AboutContent>({
    resolver: zodResolver(aboutContentSchema),
    defaultValues: initial,
    mode: "onTouched",
  });
  const { status, submit } = useSaveForm(form, saveAboutContentAction);

  return (
    <Shell form={form as unknown as AnyForm} status={status} submit={() => void submit()}>
      <Panel title="Intro">
        <div className="space-y-4">
          <TextField name="eyebrow" label="Eyebrow" maxLength={60} />
          <HeadlineFields prefix="headline" />
          <TextField name="intro" label="Introduction" multiline rows={3} maxLength={600} />
          <TextField name="body" label="Longer body copy" hint="Plain text. Separate paragraphs with a blank line." multiline rows={6} maxLength={3000} />
        </div>
      </Panel>

      <Panel title="Portrait" description="Without a portrait a neutral placeholder is shown. No image is ever generated.">
        <Controller
          control={form.control}
          name="portrait"
          render={({ field }) => (
            <div className="space-y-3">
              <ImageField
                label="Portrait"
                value={field.value?.src}
                onChange={(next) => field.onChange(next ? { src: next, alt: field.value?.alt ?? "" } : null)}
                buildPath={(ext, id) => siteImagePath("portrait", ext, id)}
                maxBytes={SITE_IMAGE_MAX_BYTES}
                error={errorAt(form.formState.errors, "portrait.src")}
              />
              {field.value && (
                <TextField name="portrait.alt" label="Alt text" maxLength={300} hint="Describe the photo for screen readers." />
              )}
            </div>
          )}
        />
      </Panel>

      <Panel title="Details">
        <div className="grid gap-3 sm:grid-cols-2">
          <TextField name="location" label="Location" hint="Shown as a “Based in” card. Leave empty to hide." maxLength={80} />
          <TextField name="availability" label="Availability text" hint="Optional line shown under the introduction." maxLength={200} />
        </div>
      </Panel>

      <Panel title="Stats" description="Metric cards under the portrait.">
        <StatsFields name="metrics" />
      </Panel>
    </Shell>
  );
}

/* --------------------------------------------------------------- contact */

export function ContactContentEditor({ initial, settingsEmail }: { initial: ContactContent; settingsEmail: string }) {
  const form = useForm<ContactContent>({
    resolver: zodResolver(contactContentSchema),
    defaultValues: initial,
    mode: "onTouched",
  });
  const { status, submit } = useSaveForm(form, saveContactContentAction);

  return (
    <Shell form={form as unknown as AnyForm} status={status} submit={() => void submit()}>
      <Panel title="Header">
        <div className="space-y-4">
          <TextField name="eyebrow" label="Eyebrow" maxLength={60} />
          <TextField name="heading" label="Heading" maxLength={100} />
          <TextField name="description" label="Description" multiline maxLength={400} />
        </div>
      </Panel>
      <Panel title="Public contact details">
        <div className="grid gap-3 sm:grid-cols-2">
          <TextField
            name="email"
            label="Public email"
            type="email"
            maxLength={200}
            hint={settingsEmail ? `Leave empty to use the site-wide email (${settingsEmail}).` : "Leave empty to use the site-wide email from Settings."}
          />
          <TextField name="responseTime" label="Response-time text" maxLength={200} />
          <TextField name="availability" label="Availability text" maxLength={200} className="sm:col-span-2" />
        </div>
      </Panel>
    </Shell>
  );
}

/* -------------------------------------------------------------- settings */

export function SettingsEditor({ initial }: { initial: SiteSettings }) {
  const form = useForm<SiteSettings>({
    resolver: zodResolver(siteSettingsSchema),
    defaultValues: initial,
    mode: "onTouched",
  });
  const { status, submit } = useSaveForm(form, saveSettingsAction);

  return (
    <Shell form={form as unknown as AnyForm} status={status} submit={() => void submit()} saveLabel="Save settings">
      <Panel title="General">
        <div className="grid gap-3 sm:grid-cols-2">
          <TextField name="siteName" label="Site name" maxLength={80} />
          <TextField name="displayName" label="Developer / display name" maxLength={80} />
          <TextField name="location" label="Location" maxLength={120} />
          <TextField name="contactEmail" label="Public contact email" type="email" maxLength={200} />
        </div>
      </Panel>
      <Panel title="Social links" description="Shown in the footer. Leave empty to hide. https:// only.">
        <div className="grid gap-3 sm:grid-cols-2">
          <TextField name="githubUrl" label="GitHub" placeholder="https://github.com/…" maxLength={300} />
          <TextField name="linkedinUrl" label="LinkedIn" placeholder="https://www.linkedin.com/in/…" maxLength={300} />
          <TextField name="instagramUrl" label="Instagram" placeholder="https://www.instagram.com/…" maxLength={300} />
          <TextField name="xUrl" label="X" placeholder="https://x.com/…" maxLength={300} />
        </div>
      </Panel>
      <Panel title="SEO" description="Defaults used when a page doesn't set its own. Project pages keep their own titles and descriptions.">
        <div className="space-y-4">
          <TextField name="seoDefaultTitle" label="Default title" maxLength={120} />
          <TextField name="seoTitleTemplate" label="Title template" hint="Use %s where the page title goes, e.g. “%s — Ian Verlinden”." maxLength={120} />
          <TextField name="seoDefaultDescription" label="Default description" multiline rows={3} maxLength={320} />
          <TextField name="seoOgTitle" label="Default Open Graph title (optional)" hint="Falls back to the default title." maxLength={120} />
        </div>
      </Panel>
      <p className="text-xs text-subtle">
        Secrets such as API keys and Supabase credentials are never stored here — they belong in environment variables.
      </p>
    </Shell>
  );
}
