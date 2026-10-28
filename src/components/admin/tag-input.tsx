"use client";

import { useState } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

type TagInputProps = {
  id: string;
  value: string[];
  onChange: (next: string[]) => void;
  max: number;
  placeholder?: string;
  invalid?: boolean;
};

/** Chip input: Enter or comma adds, Backspace on an empty field removes the last chip. */
export function TagInput({ id, value, onChange, max, placeholder, invalid }: TagInputProps) {
  const [draft, setDraft] = useState("");

  const add = (raw: string) => {
    const label = raw.trim().replace(/\s+/g, " ").slice(0, 40);
    if (!label) return;
    if (value.some((v) => v.toLowerCase() === label.toLowerCase()) || value.length >= max) {
      setDraft("");
      return;
    }
    onChange([...value, label]);
    setDraft("");
  };

  return (
    <div
      className={cn(
        "flex min-h-10 flex-wrap items-center gap-1.5 rounded-md border bg-glass px-2 py-1.5 transition-colors focus-within:border-accent",
        invalid ? "border-danger" : "border-line hover:border-line-strong",
      )}
    >
      {value.map((tag) => (
        <span
          key={tag}
          className="inline-flex items-center gap-1 rounded-full bg-accent-soft py-0.5 pr-1 pl-2.5 text-xs"
        >
          {tag}
          <button
            type="button"
            aria-label={`Remove ${tag}`}
            onClick={() => onChange(value.filter((v) => v !== tag))}
            className="inline-flex size-4 items-center justify-center rounded-full text-muted hover:bg-glass-strong hover:text-ink"
          >
            <X aria-hidden className="size-3" />
          </button>
        </span>
      ))}
      <input
        id={id}
        value={draft}
        disabled={value.length >= max}
        placeholder={value.length >= max ? `Maximum of ${max} reached` : placeholder}
        onChange={(e) => {
          const text = e.target.value;
          if (text.includes(",")) {
            const parts = text.split(",");
            parts.slice(0, -1).forEach(add);
            setDraft(parts[parts.length - 1]);
          } else {
            setDraft(text);
          }
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            add(draft);
          } else if (e.key === "Backspace" && draft === "" && value.length > 0) {
            onChange(value.slice(0, -1));
          }
        }}
        onBlur={() => add(draft)}
        className="min-w-24 flex-1 bg-transparent px-1 py-0.5 text-sm text-ink placeholder:text-subtle focus-visible:outline-none"
      />
    </div>
  );
}
