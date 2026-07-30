import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group";
import { cn } from "@/lib/utils";
import type { DashboardSearch } from "@/lib/validations/dashboard-search";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { Search, X } from "lucide-react";
import { useCallback, useState } from "react";
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
  const [isComposing, setIsComposing] = useState(false);

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
        key={query || "empty"}
        className="py-0 text-zinc-300 placeholder:text-zinc-500 max-md:w-full"
        placeholder={placeholder}
        defaultValue={query}
        onChange={(event) => {
          if (!isComposing) debouncedSearch(event.target.value);
        }}
        onCompositionStart={() => setIsComposing(true)}
        onCompositionEnd={(event) => {
          setIsComposing(false);
          debouncedSearch(event.currentTarget.value);
        }}
      />
      {query && (
        <InputGroupAddon
          align="inline-end"
          className="cursor-pointer"
          onClick={() => patchQuery(undefined)}
        >
          <X className="size-4 text-destructive" />
        </InputGroupAddon>
      )}
    </InputGroup>
  );
};
