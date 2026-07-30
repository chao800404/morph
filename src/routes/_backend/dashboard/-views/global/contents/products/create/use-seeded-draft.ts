import type { DashboardSearch } from "@/lib/validations/dashboard-search";
import { productOptionQueries } from "@queries/product.queries";
import { useQuery } from "@tanstack/react-query";
import { useSearch } from "@tanstack/react-router";
import { useEffect, useRef, type Dispatch } from "react";
import type { DraftAction } from "./use-product-draft";

/**
 * Start the wizard with what the author was already looking at.
 *
 * Someone on an option's or a category's page who wants a product built from it
 * should not have to find it again in the picker. The `seed*` params carry the
 * choice; each is only a starting point, so the wizard's own controls can still
 * change or remove it — which is why every seed applies exactly once, even if
 * its query refetches.
 */
export const useSeededDraft = (dispatch: Dispatch<DraftAction>) => {
  useSeededOption(dispatch);
  useSeededCategory(dispatch);
  useSeededCollection(dispatch);
};

/** Like a category, the id is the whole value, so it applies immediately. */
const useSeededCollection = (dispatch: Dispatch<DraftAction>) => {
  const search = useSearch({ strict: false }) as DashboardSearch;
  const seedCollectionId = search.seedCollectionId;
  const applied = useRef(false);

  useEffect(() => {
    if (applied.current || !seedCollectionId) return;
    applied.current = true;
    dispatch({
      type: "setField",
      field: "collectionId",
      value: seedCollectionId,
    });
  }, [dispatch, seedCollectionId]);
};

/**
 * A category needs no extra data — the id is the whole value — so it applies on
 * the first render rather than waiting for a query.
 */
const useSeededCategory = (dispatch: Dispatch<DraftAction>) => {
  const search = useSearch({ strict: false }) as DashboardSearch;
  const seedCategoryId = search.seedCategoryId;
  const applied = useRef(false);

  useEffect(() => {
    if (applied.current || !seedCategoryId) return;
    applied.current = true;
    dispatch({ type: "setCategoryIds", ids: [seedCategoryId] });
  }, [dispatch, seedCategoryId]);
};

/**
 * An option is applied only once its values have loaded: the draft builds the
 * variant matrix from them, so applying it earlier would add an axis with
 * nothing on it.
 */
const useSeededOption = (dispatch: Dispatch<DraftAction>) => {
  const search = useSearch({ strict: false }) as DashboardSearch;
  const seedOptionId = search.seedOptionId;
  const applied = useRef(false);

  const { data: result } = useQuery({
    ...productOptionQueries.detail(seedOptionId ?? ""),
    enabled: Boolean(seedOptionId),
  });

  useEffect(() => {
    if (applied.current || !seedOptionId) return;

    const option = result?.success ? result.data : null;
    if (!option || option.values.length === 0) return;

    applied.current = true;
    dispatch({ type: "setHasVariants", value: true });
    dispatch({
      type: "addOption",
      option: {
        optionId: option.id,
        title: option.title,
        available: option.values.map((value) => ({
          id: value.id,
          value: value.value,
        })),
        // Every value applies by default, matching what the picker does.
        selectedValueIds: option.values.map((value) => value.id),
      },
    });
  }, [dispatch, result, seedOptionId]);
};
