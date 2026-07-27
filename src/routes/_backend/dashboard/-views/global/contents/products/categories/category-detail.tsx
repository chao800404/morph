import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import type { DashboardSearch } from "@/lib/validations/dashboard-search";
import { usePageBreadcrumb } from "@/routes/_backend/dashboard/-components/breadcrumb/use-page-breadcrumb";
import { DataTableCard } from "@/routes/_backend/dashboard/-components/data-table-card";
import {
  EditCard,
  type EditCardField,
} from "@/routes/_backend/dashboard/-components/edit-card/edit-card";
import {
  normalizeProductListParams,
  productCategoryQueries,
  productQueries,
} from "@queries/product.queries";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams, useSearch } from "@tanstack/react-router";
import { useCallback } from "react";
import { CATEGORY_PRODUCT_COLUMNS } from "./config/category-detail.config";

/**
 * Category detail.
 *
 * The category itself arrives with its ancestor path and direct children,
 * which are bounded and describe the record. Its products are a separate
 * paginated query: that list grows, and folding it into the detail response
 * would make one request that never stops getting bigger.
 *
 * There is no page title bar — the record's name is the trailing breadcrumb,
 * so it is not repeated above the cards.
 */
export const CategoryDetail = () => {
  const { id } = useParams({ strict: false }) as { id: string };
  const search = useSearch({ strict: false }) as DashboardSearch;
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const { data: result, isPending } = useQuery(
    productCategoryQueries.detail(id),
  );
  const category = result?.success ? result.data : null;

  usePageBreadcrumb(category?.name ?? null);

  const productParams = {
    ...normalizeProductListParams(search),
    categoryId: id,
  };
  const { data: productResult, isPending: productsPending } = useQuery(
    productQueries.list(productParams),
  );

  const retryProducts = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: productQueries.all() });
  }, [queryClient]);

  const openEdit = useCallback(
    () =>
      void navigate({
        to: "/dashboard/$slug/$id/edit",
        params: { slug: "product-categories", id },
      }),
    [id, navigate],
  );

  if (isPending) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner />
      </div>
    );
  }

  if (!category) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 text-center">
        <p className="text-sm text-muted-foreground">
          {result?.message ?? "Category not found"}
        </p>
        <Button variant="outline" size="sm" asChild>
          <Link to="/dashboard/$slug" params={{ slug: "product-categories" }}>
            Back to categories
          </Link>
        </Button>
      </div>
    );
  }

  const products = productResult?.success
    ? (productResult.data?.products ?? [])
    : [];

  const detailFields: EditCardField[] = [
    {
      key: "description",
      label: "Description",
      value: category.description,
      displayValue: category.description || "—",
    },
    {
      key: "handle",
      label: "Handle",
      value: category.handle,
      displayValue: `/${category.handle}`,
    },
  ];

  const organizeFields: EditCardField[] = [
    {
      key: "path",
      label: "Path",
      displayValue: [...category.ancestorNames, category.name].join(" / "),
    },
    {
      key: "children",
      label: "Children",
      displayValue:
        category.children.length === 0 ? (
          "—"
        ) : (
          <span className="flex flex-wrap gap-1.5">
            {category.children.map((child) => (
              <Link
                key={child.id}
                to="/dashboard/$slug/$id"
                params={{ slug: "product-categories", id: child.id }}
              >
                <Badge variant="secondary" className="hover:bg-muted">
                  {child.name}
                </Badge>
              </Link>
            ))}
          </span>
        ),
    },
  ];

  return (
    <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
      <div className="flex min-w-0 flex-1 flex-col gap-4">
        <EditCard
          id="category-detail"
          title={category.name}
          fields={detailFields}
          onEdit={openEdit}
          headerActions={
            <>
              <Badge variant={category.isActive ? "default" : "secondary"}>
                {category.isActive ? "Active" : "Inactive"}
              </Badge>
              <Badge variant={category.isInternal ? "outline" : "secondary"}>
                {category.isInternal ? "Internal" : "Public"}
              </Badge>
            </>
          }
        />

        <DataTableCard
          label="Products"
          description="Products filed under this category."
          searchPlaceholder="Search"
          columns={CATEGORY_PRODUCT_COLUMNS}
          rows={products}
          getRowId={(product) => product.id}
          isPending={productsPending}
          errorMessage={
            productResult && !productResult.success
              ? productResult.message
              : null
          }
          onRetry={retryProducts}
          emptyTitle="No products in this category"
          emptyDescription="Assign this category to a product from the product's Organize step."
          onRowClick={(product) =>
            void navigate({
              to: "/dashboard/$slug/$id",
              params: { slug: "products", id: product.id },
            })
          }
          pagination={
            productResult?.success && productResult.data
              ? productResult.data.pagination
              : undefined
          }
        />
      </div>

      {/* Read-only: the path follows from the parent chosen at creation, and
          children are edited on their own records. */}
      <EditCard
        id="category-organize"
        title="Organize"
        fields={organizeFields}
        className="lg:w-80"
      />
    </div>
  );
};

export default CategoryDetail;
