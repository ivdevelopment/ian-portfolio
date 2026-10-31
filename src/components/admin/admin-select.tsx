"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import { nextListboxIndex, typeaheadIndex, type ListboxKey } from "@/lib/listbox-nav";
import { cn } from "@/lib/utils";
import { adminInput } from "./ui";

export type SelectOption = { value: string; label: string };

/**
 * Dark, keyboard-accessible select that replaces the browser-native popup (which is
 * bright white on Windows/Chrome). Select-only combobox pattern: focus stays on the
 * button; ↑/↓/Home/End move the highlight, Enter/Space choose, Esc closes, typing jumps.
 * Controlled (`value` / `onChange`), so it works with react-hook-form's `Controller`.
 */
export function AdminSelect({
  id,
  value,
  onChange,
  options,
  disabled,
  "aria-describedby": describedBy,
  "aria-invalid": invalid,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  options: readonly SelectOption[];
  disabled?: boolean;
  "aria-describedby"?: string;
  "aria-invalid"?: boolean;
}) {
  const listId = useId();
  const root = useRef<HTMLDivElement>(null);
  const typed = useRef({ text: "", timer: 0 });
  const selectedIndex = Math.max(0, options.findIndex((o) => o.value === value));
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(selectedIndex);

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  // Keep the highlighted option scrolled into view.
  useEffect(() => {
    if (open) document.getElementById(`${listId}-${active}`)?.scrollIntoView({ block: "nearest" });
  }, [open, active, listId]);

  const openList = () => {
    setActive(selectedIndex);
    setOpen(true);
  };

  const choose = (index: number) => {
    const option = options[index];
    if (option) onChange(option.value);
    setOpen(false);
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (disabled) return;
    const key = event.key;

    if (key === "ArrowDown" || key === "ArrowUp" || key === "Home" || key === "End") {
      event.preventDefault();
      if (!open) return openList();
      setActive((i) => nextListboxIndex(key as ListboxKey, i, options.length));
    } else if (key === "Enter" || key === " ") {
      event.preventDefault();
      if (open) choose(active);
      else openList();
    } else if (key === "Escape") {
      if (open) {
        event.preventDefault();
        setOpen(false);
      }
    } else if (key === "Tab") {
      setOpen(false);
    } else if (key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      // Type-ahead: jump to the next option starting with what was typed.
      window.clearTimeout(typed.current.timer);
      typed.current.text += key;
      typed.current.timer = window.setTimeout(() => (typed.current.text = ""), 600);
      const hit = typeaheadIndex(
        options.map((o) => o.label),
        typed.current.text,
        (open ? active : selectedIndex) - 1,
      );
      if (hit >= 0) {
        if (open) setActive(hit);
        else onChange(options[hit].value);
      }
    }
  };

  return (
    <div ref={root} className="relative">
      <button
        id={id}
        type="button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-activedescendant={open ? `${listId}-${active}` : undefined}
        aria-describedby={describedBy}
        aria-invalid={invalid}
        disabled={disabled}
        onClick={() => (open ? setOpen(false) : openList())}
        onKeyDown={onKeyDown}
        className={cn(adminInput, "flex h-10 items-center justify-between gap-2 text-left")}
      >
        <span className="truncate">{options[selectedIndex]?.label}</span>
        <ChevronDown
          aria-hidden
          className={cn("size-4 shrink-0 text-muted transition-transform duration-200", open && "rotate-180")}
        />
      </button>

      {open && (
        <ul
          id={listId}
          role="listbox"
          aria-labelledby={id}
          className="absolute z-30 mt-1.5 max-h-64 w-full overflow-auto rounded-md border border-line-strong bg-elevated p-1 shadow-lift"
        >
          {options.map((option, i) => {
            const selected = option.value === value;
            return (
              <li
                key={option.value}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={selected}
                // Keep focus on the button so keyboard handling continues to work.
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => choose(i)}
                onMouseMove={() => active !== i && setActive(i)}
                className={cn(
                  "flex cursor-pointer items-center justify-between gap-2 rounded px-3 py-2 text-sm text-ink",
                  i === active && "bg-glass-strong",
                  selected && "bg-accent-soft",
                )}
              >
                <span className="truncate">{option.label}</span>
                {selected && <Check aria-hidden className="size-4 shrink-0 text-accent" />}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
