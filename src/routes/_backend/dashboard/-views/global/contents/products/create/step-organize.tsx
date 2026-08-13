import { createSurface } from "@/components/dialog/create-surface";
import { FieldsRenderer } from "@/components/form/fields-renderer";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import type { FormFieldValue } from "@/lib/validations/form";
import {
  collectionQueries,
  normalizeCollectionListParams,
} from "@queries/product.queries";
import { useQuery } from "@tanstack/react-query";
import type { Dispatch } from "react";
import type { DraftAction, ProductDraft } from "./use-product-draft";
import {
  normalizeSalesChannelListParams,
  salesChannelQueries,
} from "@queries/sales-channel.queries";

import {
  NO_PRODUCT_COLLECTION,
  productOrganizationFields,
} from "../config/product-form-fields";

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
  const { data: channelResult, isPending: channelsPending } = useQuery(
    salesChannelQueries.list({
      ...normalizeSalesChannelListParams({ sortBy: "name", sortOrder: "asc" }),
      limit: 100,
    }),
  );

  if (collectionsPending || channelsPending) {
    return (
      <div className={cn(createSurface.content, "flex w-full justify-center")}>
        <Spinner className="size-4 text-muted-foreground" />
      </div>
    );
  }

  const collections = collectionResult?.success
    ? (collectionResult.data?.collections ?? [])
    : [];
  const salesChannels = channelResult?.success
    ? (channelResult.data?.salesChannels ?? [])
    : [];

  const fields = productOrganizationFields({
    collectionId: draft.collectionId,
    collections,
    typeValue: draft.typeValue,
    types: draft.typeValue ? [{ value: draft.typeValue }] : [],
    tagValues: draft.tagValues,
    tags: draft.tagValues.map((value) => ({ value })),
    categoryIds: draft.categoryIds,
    categories: [],
    salesChannelIds: draft.salesChannelIds,
    salesChannels,
    discountable: draft.discountable,
  });

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
            value: value === NO_PRODUCT_COLLECTION ? "" : value,
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
        className="grid-cols-1 gap-x-6 gap-y-6 sm:grid-cols-2"
        onChange={handleChange}
      />
    </div>
  );
};
