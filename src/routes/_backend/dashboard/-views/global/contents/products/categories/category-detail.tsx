import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { usePageBreadcrumb } from "@/routes/_backend/dashboard/-components/breadcrumb/use-page-breadcrumb";
import { PageSplitLayout } from "@/routes/_backend/dashboard/-components/layout/page-split-layout";
import {
  EditCard,
  type EditCardField,
} from "@/routes/_backend/dashboard/-components/edit-card/edit-card";
import { MetadataCard } from "@/routes/_backend/dashboard/-components/metadata-card/metadata-card";
import { productCategoryQueries } from "@queries/product.queries";
import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { useCallback } from "react";
import { RelatedProductsCard } from "../components/related-products-card";

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
const CategoryDetail = () => {
  const { id } = useParams({ strict: false }) as { id: string };
  const navigate = useNavigate();

  const { data: result, isPending } = useQuery(
    productCategoryQueries.detail(id),
  );
  const category = result?.success ? result.data : null;

  usePageBreadcrumb(category?.name ?? null);

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
    <PageSplitLayout
      sidebar={
        /* Read-only: the path follows from the parent chosen at creation, and
           children are edited on their own records. */
        <EditCard id="category-organize" title="Organize" fields={organizeFields} />
      }
    >
      <div className="flex flex-col gap-4">
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

        <RelatedProductsCard
          description="Products filed under this category."
          filter={{ categoryId: id }}
          seed={{ seedCategoryId: id }}
          returnTo={`/dashboard/product-categories/${id}`}
          emptyTitle="No products in this category"
          emptyDescription="Create one here, or assign this category from a product's Organize step."
        />
        <MetadataCard
          slug="product-categories"
          id={id}
          keyCount={Object.keys(category.metadata).length}
        />
      </div>
    </PageSplitLayout>
  );
};

export default CategoryDetail;
