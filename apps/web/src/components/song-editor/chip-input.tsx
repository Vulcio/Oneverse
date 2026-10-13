import { X } from "lucide-react";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { cn } from "@songverse/ui/lib/utils";

export interface ChipSuggestion {
  value: string;
  label: string;
  /** A second line, e.g. the roles someone's credited in. */
  detail?: string;
}

/**
 * Several values in one field, each shown as a removable chip, with
 * suggestions as you type (a combobox). Enter or ";" adds what's typed -
 * when `allowCustom` - or the highlighted suggestion; Backspace in an
 * empty field removes the last chip, and pasting "A; B" adds both.
 * Leaving the field keeps what's typed, rather than silently dropping it.
 */
export function ChipInput({
  id,
  values,
  onChange,
  labelFor = (value) => value,
  suggest,
  allowCustom = true,
  placeholder,
  noMatches,
  invalid,
  describedBy,
  avatar,
  removeLabel,
}: {
  id: string;
  values: string[];
  onChange: (values: string[]) => void;
  labelFor?: (value: string) => string;
  /** Suggestions for what's typed (may be async); ones already chosen are left out. */
  suggest: (query: string) => ChipSuggestion[] | Promise<ChipSuggestion[]>;
  allowCustom?: boolean;
  placeholder?: string;
  /** Shown when nothing matches and a custom value isn't allowed. */
  noMatches?: string;
  invalid?: boolean;
  describedBy?: string;
  /** Show initials beside suggestions and chips (people). */
  avatar?: boolean;
  removeLabel: (label: string) => string;
}) {
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [text, setText] = useState("");
  const [open, setOpen] = useState(false);
  const [suggestions, setSuggestions] = useState<ChipSuggestion[]>([]);
  const [active, setActive] = useState(-1);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const found = await suggest(text.trim());
        if (cancelled) return;
        const chosen = new Set(values.map((value) => value.toLowerCase()));
        setSuggestions(found.filter((s) => !chosen.has(s.value.toLowerCase())).slice(0, 8));
        setActive(-1);
      } catch {
        if (!cancelled) setSuggestions([]);
      }
    }, 150);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // `suggest` is usually an inline function: re-query on text, open and values only.
  }, [text, open, values]);

  function add(raw: string[]) {
    const next = [...values];
    for (const value of raw.map((v) => v.trim()).filter(Boolean)) {
      if (!next.some((existing) => existing.toLowerCase() === value.toLowerCase())) next.push(value);
    }
    if (next.length !== values.length) onChange(next);
    setText("");
  }

  function commitTyped(): boolean {
    const typed = text.trim();
    if (!typed) return false;
    const exact = suggestions.find((s) => s.label.toLowerCase() === typed.toLowerCase());
    if (exact) add([exact.value]);
    else if (allowCustom) add(typed.split(";"));
    else return false;
    return true;
  }

  function remove(value: string) {
    onChange(values.filter((v) => v !== value));
    inputRef.current?.focus();
  }

  const showList = open && (suggestions.length > 0 || (!allowCustom && text.trim() !== "" && !!noMatches));

  return (
    <div className="relative">
      <div
        className={cn(
          "flex min-h-9 w-full flex-wrap items-center gap-1.5 rounded-md border border-input bg-transparent px-2 py-1 text-sm shadow-xs focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/50",
          invalid && "border-destructive",
        )}
        onClick={() => inputRef.current?.focus()}
      >
        {values.map((value) => (
          <span key={value} className="flex items-center gap-1 rounded-full border bg-muted/50 py-0.5 pr-1 pl-1 text-sm">
            {avatar ? <Initials name={labelFor(value)} size="sm" /> : <span className="w-1" />}
            <span>{labelFor(value)}</span>
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                remove(value);
              }}
              className="rounded-full p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
              aria-label={removeLabel(labelFor(value))}
            >
              <X className="size-3" />
            </button>
          </span>
        ))}
        <input
          ref={inputRef}
          id={id}
          role="combobox"
          aria-expanded={showList}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined}
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy}
          value={text}
          placeholder={values.length === 0 ? placeholder : undefined}
          className="h-7 min-w-24 flex-1 bg-transparent outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed"
          onChange={(event) => {
            setText(event.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => {
            if (allowCustom) commitTyped();
            else setText("");
            setOpen(false);
          }}
          onPaste={(event) => {
            const pasted = event.clipboardData.getData("text");
            if (allowCustom && pasted.includes(";")) {
              event.preventDefault();
              add(pasted.split(";"));
            }
          }}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown" && suggestions.length > 0) {
              event.preventDefault();
              setOpen(true);
              setActive((index) => (index + 1) % suggestions.length);
            } else if (event.key === "ArrowUp" && suggestions.length > 0) {
              event.preventDefault();
              setActive((index) => (index <= 0 ? suggestions.length - 1 : index - 1));
            } else if ((event.key === "Enter" || event.key === "Tab") && active >= 0 && suggestions[active]) {
              event.preventDefault();
              add([suggestions[active].value]);
            } else if (event.key === "Enter") {
              // Never submits the form from here.
              event.preventDefault();
              commitTyped();
            } else if (event.key === ";" && allowCustom) {
              event.preventDefault();
              commitTyped();
            } else if (event.key === "Backspace" && text === "" && values.length > 0) {
              onChange(values.slice(0, -1));
            } else if (event.key === "Escape") {
              setOpen(false);
            }
          }}
        />
      </div>
      {showList ? (
        <ul
          id={listId}
          role="listbox"
          className="absolute top-full right-0 left-0 z-20 mt-1 max-h-64 overflow-auto rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
        >
          {suggestions.length === 0 ? (
            <li className="px-2 py-1.5 text-sm text-muted-foreground">{noMatches}</li>
          ) : (
            suggestions.map((suggestion, index) => (
              <li
                key={suggestion.value}
                id={`${listId}-${index}`}
                role="option"
                aria-selected={index === active}
                className={cn(
                  "flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm",
                  index === active ? "bg-accent text-accent-foreground" : "hover:bg-accent/60",
                )}
                // Before the input's blur, which would otherwise close the list first.
                onMouseDown={(event) => {
                  event.preventDefault();
                  add([suggestion.value]);
                }}
              >
                {avatar ? <Initials name={suggestion.label} /> : null}
                <span className="flex min-w-0 flex-col">
                  <span className="truncate">{suggestion.label}</span>
                  {suggestion.detail ? <span className="truncate text-xs text-muted-foreground">{suggestion.detail}</span> : null}
                </span>
              </li>
            ))
          )}
        </ul>
      ) : null}
    </div>
  );
}

export function Initials({ name, size = "md" }: { name: string; size?: "sm" | "md" }): ReactNode {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]!.toUpperCase())
    .join("");
  return (
    <span
      aria-hidden
      className={cn(
        "flex shrink-0 items-center justify-center rounded-full bg-primary/10 font-medium text-primary",
        size === "sm" ? "size-5 text-[10px]" : "size-7 text-xs",
      )}
    >
      {initials}
    </span>
  );
}
