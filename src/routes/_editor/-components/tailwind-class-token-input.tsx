import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { tokenizeTailwindClasses } from "@/lib/storefront/ast/tailwind-token-engine";
import { suggestTailwindClasses } from "@/lib/storefront/ast/tailwind-class-suggestions";
import { cn } from "@/lib/utils";
import { Plus, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

type TailwindClassTokenInputProps = {
  value: string;
  onValueChange: (value: string) => void;
  disabled?: boolean;
  placeholder?: string;
};

function readTokens(value: string): string[] {
  return tokenizeTailwindClasses(value).map((token) => token.raw);
}

function hasOpenArbitraryValue(value: string): boolean {
  let depth = 0;
  for (const char of value) {
    if (char === "[") depth += 1;
    if (char === "]") depth = Math.max(0, depth - 1);
  }
  return depth > 0;
}

export function TailwindClassTokenInput({
  value,
  onValueChange,
  disabled = false,
  placeholder = "Type a Tailwind class…",
}: TailwindClassTokenInputProps) {
  const [tokens, setTokens] = useState(() => readTokens(value));
  const [draft, setDraft] = useState("");
  const [focused, setFocused] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => setTokens(readTokens(value)), [value]);

  const excluded = useMemo(() => new Set(tokens), [tokens]);
  const suggestions = useMemo(
    () => suggestTailwindClasses(draft, excluded),
    [draft, excluded],
  );
  const showSuggestions = focused && !disabled && draft.trim().length > 0;

  const publish = (nextTokens: string[]) => {
    const unique = Array.from(new Set(nextTokens.filter(Boolean)));
    setTokens(unique);
    onValueChange(unique.join(" "));
  };

  const addValues = (rawValues: string) => {
    const additions = readTokens(rawValues).filter((token) => !excluded.has(token));
    if (additions.length > 0) publish([...tokens, ...additions]);
    setDraft("");
    setActiveIndex(0);
  };

  const removeToken = (tokenToRemove: string) => {
    if (disabled) return;
    publish(tokens.filter((token) => token !== tokenToRemove));
    inputRef.current?.focus();
  };

  return (
    <div className="relative">
      <div
        className={cn(
          "flex min-h-20 flex-wrap content-start gap-1.5 rounded-md border bg-background p-2 shadow-xs",
          "focus-within:border-ring focus-within:ring-ring/50 focus-within:ring-[3px]",
          disabled && "cursor-not-allowed opacity-50",
        )}
        onClick={() => inputRef.current?.focus()}
      >
        {tokens.map((token) => (
          <Badge
            key={token}
            variant="neutral"
            className="h-6 max-w-full gap-1 px-1.5 font-mono text-[11px]"
          >
            <span className="truncate">{token}</span>
            <button
              type="button"
              className="rounded-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
              aria-label={`Remove ${token}`}
              disabled={disabled}
              onClick={(event) => {
                event.stopPropagation();
                removeToken(token);
              }}
            >
              <X className="size-3" />
            </button>
          </Badge>
        ))}
        <Input
          ref={inputRef}
          value={draft}
          variant="bare"
          disabled={disabled}
          aria-label="Add Tailwind CSS class"
          aria-autocomplete="list"
          aria-expanded={showSuggestions}
          placeholder={tokens.length === 0 ? placeholder : "Add class…"}
          className="h-6 min-w-32 flex-1 p-0 font-mono text-xs focus-visible:ring-0"
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onChange={(event) => {
            setDraft(event.target.value);
            setActiveIndex(0);
          }}
          onPaste={(event) => {
            const pasted = event.clipboardData.getData("text");
            if (readTokens(pasted).length === 0) return;
            event.preventDefault();
            addValues(pasted);
          }}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown" && suggestions.length > 0) {
              event.preventDefault();
              setActiveIndex((index) => (index + 1) % suggestions.length);
              return;
            }
            if (event.key === "ArrowUp" && suggestions.length > 0) {
              event.preventDefault();
              setActiveIndex((index) => (index - 1 + suggestions.length) % suggestions.length);
              return;
            }
            if (event.key === "Escape") {
              setDraft("");
              return;
            }
            if (event.key === "Backspace" && draft.length === 0 && tokens.length > 0) {
              event.preventDefault();
              removeToken(tokens[tokens.length - 1]);
              return;
            }
            if (event.key === "Enter") {
              event.preventDefault();
              const selected = suggestions[activeIndex]?.value ?? draft;
              if (selected.trim()) addValues(selected);
              return;
            }
            if ((event.key === " " || event.key === ",") && draft.trim() && !hasOpenArbitraryValue(draft)) {
              event.preventDefault();
              addValues(draft);
            }
          }}
        />
      </div>

      {showSuggestions ? (
        <div
          role="listbox"
          aria-label="Tailwind CSS class suggestions"
          className="absolute inset-x-0 top-full z-50 mt-1 max-h-56 overflow-y-auto rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
        >
          {suggestions.length > 0 ? (
            suggestions.map((suggestion, index) => (
              <button
                key={suggestion.value}
                type="button"
                role="option"
                aria-selected={index === activeIndex}
                className={cn(
                  "flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left outline-none",
                  index === activeIndex && "bg-accent text-accent-foreground",
                )}
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => addValues(suggestion.value)}
              >
                <Plus className="size-3.5 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate font-mono text-xs">{suggestion.value}</span>
                <span className="shrink-0 text-[10px] text-muted-foreground">{suggestion.group}</span>
              </button>
            ))
          ) : (
            <button
              type="button"
              className="flex w-full items-center gap-2 rounded-sm px-2 py-2 text-left text-xs hover:bg-accent"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => addValues(draft)}
            >
              <Plus className="size-3.5" />
              Add custom class <span className="truncate font-mono">{draft}</span>
            </button>
          )}
        </div>
      ) : null}
    </div>
  );
}
