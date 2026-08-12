import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group";
import { cn } from "@/lib/utils";
import type { DashboardSearch } from "@/lib/validations/dashboard-search";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { Search, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useDebouncedCallback } from "use-debounce";

/**
 * Search box for `DataTableCard`.
 *
 * The term lives in the route's `q` search param rather than component state,
 * so the filtered view is shareable and survives a back navigation, and the
 * list query reads it through the same normaliser the route loader uses.
 */
export const DataTableSearch = ({
  placeholder = "Search",
  className,
}: {
  placeholder?: string;
  className?: string;
}) => {
  const navigate = useNavigate();
  const search = useSearch({ strict: false }) as DashboardSearch;
  const query = search.q ?? "";
  const [value, setValue] = useState(query);
  const [isComposing, setIsComposing] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Route state can change through Back/Forward or a filter reset. Keep the
  // draft in sync without keying/remounting the input, which would discard its
  // focus and selection every time the debounced search updates the URL.
  useEffect(() => setValue(query), [query]);

  const patchQuery = useCallback(
    (value: string | undefined) => {
      navigate({
        to: ".",
        // Changing the term resets to the first page; staying on page 5 of a
        // narrower result set would show an empty table.
        search: (prev: DashboardSearch) => ({
          ...prev,
          q: value || undefined,
          page: undefined,
        }),
        replace: true,
      });
    },
    [navigate],
  );

  const debouncedSearch = useDebouncedCallback(patchQuery, 400);

  return (
    <InputGroup
      className={cn("w-52 max-md:w-full max-md:flex-1", className)}
      variant="cardHeader"
      size="xs"
    >
      <InputGroupAddon>
        <Search className="size-4" />
      </InputGroupAddon>
      <InputGroupInput
        ref={inputRef}
        aria-label={placeholder}
        className="py-0 text-foreground placeholder:text-muted-foreground max-md:w-full"
        placeholder={placeholder}
        value={value}
        onChange={(event) => {
          const nextValue = event.target.value;
          setValue(nextValue);
          if (!isComposing) debouncedSearch(nextValue);
        }}
        onCompositionStart={() => setIsComposing(true)}
        onCompositionEnd={(event) => {
          setIsComposing(false);
          debouncedSearch(event.currentTarget.value);
        }}
      />
      {value && (
        <InputGroupAddon align="inline-end">
          <InputGroupButton
            aria-label="Clear search"
            variant="none"
            size="icon-xs"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => {
              debouncedSearch.cancel();
              setValue("");
              patchQuery(undefined);
              inputRef.current?.focus();
            }}
          >
            <X className="size-4 text-destructive" />
          </InputGroupButton>
        </InputGroupAddon>
      )}
    </InputGroup>
  );
};
