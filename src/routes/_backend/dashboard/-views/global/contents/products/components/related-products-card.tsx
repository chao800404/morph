import { Button } from "@/components/ui/button";
import { findCollection } from "@/lib/config/navigation";
import type { ProductDTO } from "@/lib/product/dto/product.dto";
import type { DashboardSearch } from "@/lib/validations/dashboard-search";
import {
  DataTableCard,
  type DataTableColumn,
} from "@/routes/_backend/dashboard/-components/data-table-card";
import { useViewPreload } from "@/routes/_backend/dashboard/-components/use-view-preload";
import { getConfig } from "@/server/get-config";
import {
  normalizeProductListParams,
  productQueries,
} from "@queries/product.queries";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { Plus } from "lucide-react";
import { useCallback, useMemo } from "react";
import { ProductStatusBadge } from "./product-status-badge";

/**
 * The products belonging to another record — an option, a category, later a
 * collection.
 *
 * One component because the three differ only in which id filters the list and
 * what the create button seeds. The columns in particular were duplicated
 * verbatim between the option and category pages before this existed.
 *
 * Sales channels are absent from Medusa's equivalent column set because that
 * module does not exist here yet; an empty column would imply missing data
 * rather than a missing feature.
 */
const COLUMNS = [
  {
    key: "title",
    header: "Product",
    className: "font-medium",
    cell: (product) => product.title,
  },
  {
    key: "handle",
    header: "Handle",
    className: "text-muted-foreground",
    cell: (product) => `/${product.handle}`,
  },
  {
    key: "status",
    header: "Status",
    className: "w-32",
    cell: (product) => (
      <ProductStatusBadge status={product.status} variant="plain" />
    ),
  },
] satisfies DataTableColumn<ProductDTO>[];

/** What the create wizard is told to apply, per the `seed*` convention. */
export type ProductSeed = Pick<
  DashboardSearch,
  "seedOptionId" | "seedCategoryId" | "seedCollectionId"
>;

export const RelatedProductsCard = ({
  description,
  filter,
  seed,
  returnTo,
  emptyTitle,
  emptyDescription,
}: {
  description: string;
  /** Exactly one of these narrows the list. */
  filter: { optionId?: string; categoryId?: string; collectionId?: string };
  seed: ProductSeed;
  /** Where the wizard returns on close, so it is not the product list. */
  returnTo: string;
  emptyTitle: string;
  emptyDescription: string;
}) => {
  const search = useSearch({ strict: false }) as DashboardSearch;
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  // Must match the route's prefetch exactly, or it primes a different cache
  // entry and the card requests the same page a second time.
  const params = { ...normalizeProductListParams(search), ...filter };
  const { data: result, isPending } = useQuery(productQueries.list(params));

  const createView = useMemo(
    () =>
      findCollection(getConfig().client.collections.global, "products")?.create
        ?.view,
    [],
  );
  const preload = useViewPreload(createView);

  const retry = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: productQueries.all() });
  }, [queryClient]);

  const createProduct = useCallback(
    () =>
      void navigate({
        to: "/dashboard/$slug/create",
        params: { slug: "products" },
        search: { ...seed, returnTo },
      }),
    [navigate, returnTo, seed],
  );

  const products = result?.success ? (result.data?.products ?? []) : [];

  return (
    <DataTableCard
      label="Products"
      description={description}
      searchPlaceholder="Search"
      headerActions={
        <Button
          variant="form"
          size="xs"
          className="gap-2"
          onClick={createProduct}
          {...preload}
        >
          <Plus className="size-4" />
          Create
        </Button>
      }
      columns={COLUMNS}
      rows={products}
      getRowId={(product) => product.id}
      isPending={isPending}
      errorMessage={result && !result.success ? result.message : null}
      onRetry={retry}
      emptyTitle={emptyTitle}
      emptyDescription={emptyDescription}
      onRowClick={(product) =>
        void navigate({
          to: "/dashboard/$slug/$id",
          params: { slug: "products", id: product.id },
        })
      }
      pagination={
        result?.success && result.data ? result.data.pagination : undefined
      }
    />
  );
};
