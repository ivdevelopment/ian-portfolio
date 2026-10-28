"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { CheckCircle2, Loader2, TriangleAlert } from "lucide-react";
import { submitReviewAction } from "@/app/(site)/review/[token]/actions";
import { publicReviewSchema, type PublicReviewValues, type ReviewSubmitResult } from "@/lib/schemas/review";
import { INVALID_REVIEW_LINK_MESSAGE } from "@/lib/review-tokens";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { RatingInput } from "./rating-input";

const inputClass =
  "w-full rounded-md border border-line bg-glass px-4 text-ink placeholder:text-subtle transition-colors duration-300 " +
  "hover:border-line-strong focus-visible:border-accent focus-visible:outline-none aria-[invalid=true]:border-danger";

type ReviewFormProps = {
  token: string;
  clientName?: string;
  projectTitle?: string;
  projectThumbnail?: string;
};

export function ReviewForm({ token, clientName, projectTitle, projectThumbnail }: ReviewFormProps) {
  const [result, setResult] = useState<ReviewSubmitResult | null>(null);
  const openedAt = useRef(0);

  useEffect(() => {
    openedAt.current = Date.now();
  }, []);

  const {
    register,
    handleSubmit,
    setValue,
    setError,
 control,
    formState: { errors, isSubmitting },
  } = useForm<PublicReviewValues>({
    resolver: zodResolver(publicReviewSchema),
    mode: "onTouched",
    defaultValues: { name: clientName ?? "", company: "", role: "", review: "", website: "" },
  });
  const rating = useWatch({ control, name: "rating" });
  const reviewLength = useWatch({ control, name: "review" })?.length ?? 0;

  const send = async (values: PublicReviewValues, elapsedMs: number) => {
    setResult(null);
    try {
      const response = await submitReviewAction(token, values, elapsedMs);
      if (response.status === "invalid-input") {
        for (const [field, messages] of Object.entries(response.fieldErrors)) {
          const message = messages?.[0];
          if (message) setError(field as keyof PublicReviewValues, { message });
        }
      }
      setResult(response);
    } catch {
      setResult({ status: "error", message: "Something went wrong. Please try again." });
    }
  };

  if (result?.status === "submitted") {
    return (
      <div role="status" className="glass rounded-panel p-8 text-center sm:p-12">
        <CheckCircle2 aria-hidden className="mx-auto size-10 text-accent" />
        <h2 className="text-title mt-5">Thanks for your review.</h2>
        <p className="mx-auto mt-3 max-w-md text-muted">
          It has been submitted and will appear on the website after approval.
        </p>
      </div>
    );
  }

  if (result?.status === "invalid-link") {
    return (
      <div role="alert" className="glass rounded-panel p-8 text-center sm:p-12">
        <p className="text-lg">{INVALID_REVIEW_LINK_MESSAGE}</p>
      </div>
    );
  }

  return (
    <form
      noValidate
      method="post"
      onSubmit={(event) => {
        const elapsedMs = Date.now() - openedAt.current;
        void handleSubmit((values) => send(values, elapsedMs))(event);
      }}
      className="glass rounded-panel p-6 sm:p-9"
    >
      {projectTitle && (
        <div className="mb-6 flex items-center gap-4 rounded-card border border-line p-3">
          {projectThumbnail && (
            <Image
              src={projectThumbnail}
              alt=""
              width={96}
              height={60}
              className="h-[3.75rem] w-24 shrink-0 rounded-md object-cover"
            />
          )}
          <p className="text-sm">
            <span className="block text-muted">Your project</span>
            <span className="font-medium">{projectTitle}</span>
          </p>
        </div>
      )}

      <div className="grid gap-x-8 gap-y-6 sm:grid-cols-2">
        <div>
          <label htmlFor="name" className="mb-2 block text-sm font-medium">
            Name
          </label>
          <input
            id="name"
            type="text"
            autoComplete="name"
            aria-invalid={Boolean(errors.name)}
            aria-describedby={errors.name ? "name-error" : undefined}
            className={cn(inputClass, "h-12")}
            {...register("name")}
          />
          {errors.name && (
            <p id="name-error" role="alert" className="mt-1.5 text-sm text-danger">
              {errors.name.message}
            </p>
          )}
        </div>
        <div>
          <label htmlFor="company" className="mb-2 block text-sm font-medium">
            Company <span className="font-normal text-subtle">(optional)</span>
          </label>
          <input
            id="company"
            type="text"
            autoComplete="organization"
            className={cn(inputClass, "h-12")}
            {...register("company")}
          />
        </div>
        <div className="sm:col-span-2">
          <label htmlFor="role" className="mb-2 block text-sm font-medium">
            Role <span className="font-normal text-subtle">(optional)</span>
          </label>
          <input
            id="role"
            type="text"
            autoComplete="organization-title"
            placeholder="e.g. Founder"
            className={cn(inputClass, "h-12")}
            {...register("role")}
          />
        </div>

        <div className="sm:col-span-2">
          <RatingInput
            value={rating}
            onChange={(v) => setValue("rating", v, { shouldValidate: true, shouldDirty: true })}
            error={errors.rating?.message}
            errorId="rating-error"
          />
        </div>

        <div className="sm:col-span-2">
          <label htmlFor="review" className="mb-2 block text-sm font-medium">
            Your review
          </label>
          <textarea
            id="review"
            rows={7}
            maxLength={4000}
            placeholder="How did the project go?"
            aria-invalid={Boolean(errors.review)}
            aria-describedby={errors.review ? "review-error" : "review-count"}
            className={cn(inputClass, "resize-y py-3.5")}
            {...register("review")}
          />
          <div className="mt-1.5 flex justify-between gap-4 text-sm">
            {errors.review ? (
              <p id="review-error" role="alert" className="text-danger">
                {errors.review.message}
              </p>
            ) : (
              <span />
            )}
            <span id="review-count" className="text-subtle tabular-nums">
              {reviewLength} / 4000
            </span>
          </div>
        </div>
      </div>

      {/* Honeypot: hidden from people, tempting for bots. */}
      <div aria-hidden className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
        <label>
          Website
          <input type="text" tabIndex={-1} autoComplete="off" {...register("website")} />
        </label>
      </div>

      {result?.status === "error" && (
        <div role="alert" className="mt-6 flex gap-3 rounded-md border border-danger/40 p-4 text-sm">
          <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-danger" />
          <p>{result.message}</p>
        </div>
      )}

      <Button type="submit" size="lg" icon="arrow" disabled={isSubmitting} className="mt-8 w-full sm:w-auto">
        {isSubmitting && <Loader2 aria-hidden className="size-4 animate-spin" />}
        {isSubmitting ? "Sending…" : "Submit review"}
      </Button>
    </form>
  );
}
