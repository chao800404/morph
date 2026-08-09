import { createSurface } from "@/components/dialog/create-surface";
import { FieldsRenderer } from "@/components/form/fields-renderer";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import type { FormField, FormFieldValue } from "@/lib/validations/form";
import {
  collectionQueries,
  normalizeCollectionListParams,
  productTaxonomyQueries,
} from "@queries/product.queries";
import { useQuery } from "@tanstack/react-query";
import type { Dispatch } from "react";
import { categoryDepth } from "@/lib/product/category-tree";
import type { DraftAction, ProductDraft } from "./use-product-draft";
import {
  normalizeSalesChannelListParams,
  salesChannelQueries,
} from "@queries/sales-channel.queries";

const NO_COLLECTION = "__none__";

/** `FieldsRenderer` also emits `File[]`, which none of these fields produce. */
const isStringArray = (value: FormFieldValue | File[]): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === "string");

export const StepOrganize = ({
  draft,
  dispatch,
}: {
  draft: ProductDraft;
  dispatch: Dispatch<DraftAction>;
}) => {
  const { data: collectionResult, isPending: collectionsPending } = useQuery(
    collectionQueries.list({
      ...normalizeCollectionListParams({}),
      limit: 100,
    }),
  );
  const { data: taxonomyResult, isPending: taxonomyPending } = useQuery(
    productTaxonomyQueries.list(),
  );
  const { data: channelResult, isPending: channelsPending } = useQuery(
    salesChannelQueries.list({
      ...normalizeSalesChannelListParams({ sortBy: "name", sortOrder: "asc" }),
      limit: 100,
    }),
  );

  if (collectionsPending || taxonomyPending || channelsPending) {
    return (
      <div className={cn(createSurface.content, "flex w-full justify-center")}>
        <Spinner className="size-4 text-muted-foreground" />
      </div>
    );
  }

  const collections = collectionResult?.success
    ? (collectionResult.data?.collections ?? [])
    : [];
  const taxonomy = taxonomyResult?.success ? taxonomyResult.data : null;

  // Types and tags are identified by their value, not their id: the server
  // upserts them, so a name typed here needs no row to exist first.
  const toValueChoices = (values: { value: string }[]) =>
    values.map(({ value }) => ({ id: value, value }));

  const categories = taxonomy?.categories ?? [];
  const salesChannels = channelResult?.success
    ? (channelResult.data?.salesChannels ?? [])
    : [];

  const fields: FormField[] = [
    {
      type: "switch",
      name: "discountable",
      label: "Discountable",
      description: "When off, promotions and discounts never apply.",
      value: draft.discountable,
      colSpan: 1,
    },
    {
      type: "select",
      name: "collectionId",
      label: "Collection",
      optional: true,
      value: draft.collectionId || NO_COLLECTION,
      options: [
        { value: NO_COLLECTION, label: "No collection" },
        ...collections.map((collection) => ({
          value: collection.id,
          label: collection.title,
        })),
      ],
      colSpan: 1,
    },
    {
      type: "option-values",
      name: "typeValue",
      label: "Type",
      optional: true,
      choices: toValueChoices(taxonomy?.types ?? []),
      value: draft.typeValue ? [draft.typeValue] : [],
      allowCreate: true,
      maxSelected: 1,
      placeholder: "Select or create a type...",
      searchPlaceholder: "Search types...",
      emptyMessage: "No type found.",
      colSpan: 1,
    },
    {
      type: "option-values",
      name: "tagValues",
      label: "Tags",
      optional: true,
      choices: toValueChoices(taxonomy?.tags ?? []),
      value: draft.tagValues,
      allowCreate: true,
      placeholder: "Select or create tags...",
      searchPlaceholder: "Search tags...",
      emptyMessage: "No tag found.",
      colSpan: 1,
    },
    categories.length > 0
      ? {
          type: "option-values",
          name: "categoryIds",
          label: "Categories",
          optional: true,
          choices: categories.map((category) => ({
            id: category.id,
            value: `${"— ".repeat(categoryDepth(category.mpath))}${category.name}`,
          })),
          value: draft.categoryIds,
          placeholder: "Select categories...",
          searchPlaceholder: "Search categories...",
          emptyMessage: "No category found.",
          colSpan: 1,
        }
      : {
          type: "tip",
          name: "categories-empty",
          label: "Categories:",
          description:
            "None exist yet. A product can still be created without one.",
          colSpan: 1,
        },
    {
      type: "option-values",
      name: "salesChannelIds",
      label: "Sales Channels",
      optional: true,
      choices: salesChannels.map((channel) => ({
        id: channel.id,
        value: channel.name,
      })),
      value: draft.salesChannelIds,
      placeholder: "Select sales channels...",
      searchPlaceholder: "Search sales channels...",
      emptyMessage: "No sales channel found.",
      colSpan: 1,
    },
  ];

  const handleChange = (name: string, value: FormFieldValue | File[]) => {
    switch (name) {
      case "discountable":
        if (typeof value === "boolean") {
          dispatch({ type: "setDiscountable", value });
        }
        return;
      case "collectionId":
        if (typeof value === "string") {
          dispatch({
            type: "setField",
            field: "collectionId",
            value: value === NO_COLLECTION ? "" : value,
          });
        }
        return;
      case "typeValue":
        if (isStringArray(value)) {
          // One type per product, so the newest pick replaces the last.
          dispatch({
            type: "setField",
            field: "typeValue",
            value: value.at(-1) ?? "",
          });
        }
        return;
      case "tagValues":
        if (isStringArray(value)) {
          dispatch({ type: "setTagValues", values: value });
        }
        return;
      case "categoryIds":
        if (isStringArray(value)) {
          dispatch({ type: "setCategoryIds", ids: value });
        }
        return;
      case "salesChannelIds":
        if (isStringArray(value)) {
          dispatch({ type: "setSalesChannelIds", ids: value });
        }
        return;
    }
  };

  return (
    <div className={cn(createSurface.content, "flex w-full flex-col gap-4")}>
      <h2 className="text-lg font-medium text-foreground">Organize</h2>

      <FieldsRenderer
        fields={fields}
        className="grid-cols-1 gap-y-6"
        onChange={handleChange}
      />
    </div>
  );
};
