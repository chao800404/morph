import type { RemoteSelectFormField } from "@/lib/validations/form";
import { remoteOptionQueries } from "@queries/remote-options.queries";
import { useInfiniteQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useDebounce } from "use-debounce";
import { OptionValuesField } from "@/components/form/option-values-field";

export function RemoteSelectField({
  field,
  value,
  onChange,
}: {
  field: RemoteSelectFormField;
  value: string;
  onChange?: (value: string) => void;
}) {
  const [search, setSearch] = useState("");
  const [debouncedSearch] = useDebounce(search, 300);
  const query = useInfiniteQuery(
    remoteOptionQueries.pages({
      source: field.remoteSource,
      query: debouncedSearch || undefined,
      selectedIds:
        value && value !== "root" && value !== "__root__" ? [value] : undefined,
      limit: 20,
    }),
  );
  const choices = useMemo(() => {
    const byId = new Map<string, { id: string; value: string }>();
    const excluded = new Set(field.excludedIds ?? []);
    if (field.remoteSource === "asset-folders") {
      byId.set("root", { id: "root", value: "Root" });
    }
    field.choices?.forEach((choice) => byId.set(choice.id, choice));
    query.data?.pages.forEach((page) => {
      if (!page.success || !page.data) return;
      [...page.data.selectedItems, ...page.data.items].forEach(
        (item) =>
          !excluded.has(item.id) &&
          byId.set(item.id, { id: item.id, value: item.label }),
      );
    });
    return [...byId.values()];
  }, [field.choices, field.excludedIds, field.remoteSource, query.data]);

  return (
    <OptionValuesField
      name={field.name}
      choices={choices}
      selectedIds={value ? [value] : []}
      onSelectionChange={(ids) => onChange?.(ids.at(-1) ?? "")}
      maxSelected={1}
      serialize="scalar"
      placeholder={field.placeholder}
      searchPlaceholder={field.searchPlaceholder}
      emptyMessage={query.isPending ? "Loading..." : field.emptyMessage}
      onSearchChange={setSearch}
      hasMore={query.hasNextPage}
      onLoadMore={() => void query.fetchNextPage()}
      className={field.componentClassName}
    />
  );
}
