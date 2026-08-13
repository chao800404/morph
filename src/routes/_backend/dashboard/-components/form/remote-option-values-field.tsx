import type { OptionValuesFormField } from "@/lib/validations/form";
import { taxQueries } from "@queries/tax.queries";
import { remoteOptionQueries } from "@queries/remote-options.queries";
import { useInfiniteQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useDebounce } from "use-debounce";
import { OptionValuesField } from "@/components/form/option-values-field";

type RemoteSource = NonNullable<OptionValuesFormField["remoteSource"]>;
type TaxRemoteSource = Extract<RemoteSource, `tax-${string}`>;

const referenceOf = (source: TaxRemoteSource) =>
  ({
    "tax-products": "product",
    "tax-product-types": "product_type",
    "tax-shipping-options": "shipping_option",
  })[source] as "product" | "product_type" | "shipping_option";

export function RemoteOptionValuesField({
  field,
  selectedIds,
  onSelectionChange,
}: {
  field: OptionValuesFormField & { remoteSource: RemoteSource };
  selectedIds: string[];
  onSelectionChange?: (ids: string[]) => void;
}) {
  const [search, setSearch] = useState("");
  const [debouncedSearch] = useDebounce(search, 300);
  const isTaxSource = field.remoteSource.startsWith("tax-");
  const reference = isTaxSource
    ? referenceOf(field.remoteSource as TaxRemoteSource)
    : "product";
  const taxQuery = useInfiniteQuery({
    ...taxQueries.ruleTargetPages({
      reference,
      query: debouncedSearch || undefined,
      limit: 20,
    }),
    enabled: isTaxSource,
  });
  const remoteQuery = useInfiniteQuery({
    ...remoteOptionQueries.pages({
      source: field.remoteSource as
        | "product-types"
        | "product-tags"
        | "product-categories",
      query: debouncedSearch || undefined,
      selectedIds:
        field.remoteSource === "product-categories" ? selectedIds : undefined,
      limit: 20,
    }),
    enabled: !isTaxSource,
  });
  const choices = useMemo(() => {
    const byId = new Map((field.choices ?? []).map((item) => [item.id, item]));
    taxQuery.data?.pages.forEach((page) => {
      if (!page.success) return;
      page.data.items.forEach((item) =>
        byId.set(item.id, { id: item.id, value: item.label }),
      );
    });
    remoteQuery.data?.pages.forEach((page) => {
      if (!page.success || !page.data) return;
      [...page.data.selectedItems, ...page.data.items].forEach((item) =>
        byId.set(
          field.remoteSource === "product-types" ||
            field.remoteSource === "product-tags"
            ? item.label
            : item.id,
          {
            id:
              field.remoteSource === "product-types" ||
              field.remoteSource === "product-tags"
                ? item.label
                : item.id,
            value: item.label,
          },
        ),
      );
    });
    return [...byId.values()];
  }, [field.choices, remoteQuery.data, taxQuery.data]);
  const activeQuery = isTaxSource ? taxQuery : remoteQuery;

  return (
    <OptionValuesField
      name={field.name}
      choices={choices}
      selectedIds={selectedIds}
      onSelectionChange={onSelectionChange}
      maxSelected={field.maxSelected}
      placeholder={field.placeholder}
      searchPlaceholder={field.searchPlaceholder}
      emptyMessage={activeQuery.isPending ? "Loading..." : field.emptyMessage}
      onSearchChange={setSearch}
      hasMore={activeQuery.hasNextPage}
      onLoadMore={() => void activeQuery.fetchNextPage()}
      className={field.componentClassName}
    />
  );
}
