"use client";

import { useRef, useState } from "react";
import { ImagePlus, Loader2, Trash2 } from "lucide-react";
import { resolveMediaUrl } from "@/lib/cms/mappers";
import { checkUpload, formatBytes } from "@/lib/media-rules";
import { createBrowserSupabase } from "@/lib/supabase/browser";
import { SITE_BUCKET } from "@/lib/supabase/env";
import { uploadToStorage } from "@/lib/upload";
import { cn } from "@/lib/utils";

type ImageFieldProps = {
  label: string;
  /** Storage path, app-relative path or URL; empty when unset. */
  value: string | null | undefined;
  onChange: (next: string | null) => void;
  /** Builds the Storage key for a new upload, e.g. `site/hero/<uuid>.png`. */
  buildPath: (ext: string, id: string) => string;
  maxBytes: number;
  hint?: string;
  error?: string;
  /** Required images can be replaced but not cleared. */
  allowRemove?: boolean;
  /** Small round preview (avatars). */
  round?: boolean;
};

/**
 * Single-image uploader for the `site-media` bucket (review avatars, hero,
 * portrait, CTA). Uploads go browser -> Storage as the signed-in admin (Storage
 * RLS enforces who may write); the server action re-validates the path on save.
 */
export function ImageField({
  label,
  value,
  onChange,
  buildPath,
  maxBytes,
  hint,
  error,
  allowRemove = true,
  round,
}: ImageFieldProps) {
  const input = useRef<HTMLInputElement>(null);
  const sessionUploads = useRef<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [problem, setProblem] = useState<string | null>(null);
  const src = resolveMediaUrl(value);

  const discardIfUnsaved = async (path: string | null | undefined) => {
    if (path && sessionUploads.current.has(path)) {
      sessionUploads.current.delete(path);
      await createBrowserSupabase().storage.from(SITE_BUCKET).remove([path]);
    }
  };

  const upload = async (file: File) => {
    setProblem(null);
    const check = checkUpload(file, { imagesOnly: true, maxBytes });
    if (!check.ok) {
      setProblem(check.error);
      return;
    }
    const { data } = await createBrowserSupabase().auth.getSession();
    const token = data.session?.access_token;
    if (!token) {
      setProblem("Your session expired. Sign in again.");
      return;
    }

    const path = buildPath(check.ext, crypto.randomUUID());
    setBusy(true);
    setProgress(0);
    try {
      await uploadToStorage({ bucket: SITE_BUCKET, path, file, accessToken: token, onProgress: setProgress });
      sessionUploads.current.add(path);
      const previous = value;
      onChange(path);
      void discardIfUnsaved(previous);
    } catch (err) {
      setProblem(err instanceof Error ? err.message : "Upload failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <p className="mb-1.5 text-xs font-medium text-muted">{label}</p>
      <div className="flex items-center gap-4">
        <div
          className={cn(
            "relative shrink-0 overflow-hidden border border-line bg-elevated",
            round ? "size-16 rounded-full" : "h-20 w-32 rounded-md",
          )}
        >
          {src ? (
            // eslint-disable-next-line @next/next/no-img-element -- admin preview
            <img src={src} alt="" loading="lazy" decoding="async" className="size-full object-cover" />
          ) : (
            <span className="flex size-full items-center justify-center text-[0.65rem] text-subtle">No image</span>
          )}
        </div>

        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => input.current?.click()}
              className="inline-flex h-8 items-center gap-1.5 rounded-md border border-line px-3 text-xs text-muted transition-colors hover:border-line-strong hover:bg-glass-strong hover:text-ink disabled:opacity-50"
            >
              {busy ? <Loader2 aria-hidden className="size-3.5 animate-spin" /> : <ImagePlus aria-hidden className="size-3.5" />}
              {busy ? `Uploading ${Math.round(progress * 100)}%` : value ? "Replace" : "Upload"}
            </button>
            {allowRemove && value && !busy && (
              <button
                type="button"
                onClick={() => {
                  const previous = value;
                  onChange(null);
                  void discardIfUnsaved(previous);
                }}
                className="inline-flex h-8 items-center gap-1.5 rounded-md border border-line px-3 text-xs text-muted transition-colors hover:border-danger/50 hover:text-danger"
              >
                <Trash2 aria-hidden className="size-3.5" />
                Remove
              </button>
            )}
          </div>
          <p className="mt-1.5 text-xs text-subtle">
            {hint ?? `PNG, JPG or WebP, up to ${formatBytes(maxBytes)}.`}
          </p>
        </div>
        <input
          ref={input}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className="sr-only"
          aria-label={`Upload ${label}`}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void upload(file);
            e.target.value = "";
          }}
        />
      </div>
      {(problem || error) && (
        <p role="alert" className="mt-1.5 text-xs text-danger">
          {problem ?? error}
        </p>
      )}
    </div>
  );
}
