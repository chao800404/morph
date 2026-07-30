import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { usePageBreadcrumb } from "@/routes/_backend/dashboard/-components/breadcrumb/use-page-breadcrumb";
import { PageSplitLayout } from "@/routes/_backend/dashboard/-components/layout/page-split-layout";
import { MetadataCard } from "@/routes/_backend/dashboard/-components/metadata-card/metadata-card";
import { productQueries } from "@queries/product.queries";
import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { useCallback } from "react";
import { ProductAttributesCard } from "./product-attributes-card";
import { ProductGeneralCard } from "./product-general-card";
import { ProductMediaCard } from "./product-media-card";
import { ProductOptionsCard } from "./product-options-card";
import { ProductOrganizationCard } from "./product-organization-card";
import { ProductVariantsCard } from "./product-variants-card";

/**
 * Product detail.
 *
 * Laid out like Medusa's: what the product *is* runs down the main column
 * (general, media, options, variants) and how it is *classified* sits in the
 * sidebar (organization, attributes, metadata). Sales channels and shipping
 * profiles are the two sections deliberately missing — this catalogue does not
 * model either, so a product is available everywhere once published.
 */
const ProductDetail = () => {
  const { id } = useParams({ strict: false }) as { id: string };
  const navigate = useNavigate();

  const { data: result, isPending } = useQuery(productQueries.detail(id));
  const product = result?.success ? result.data : null;

  usePageBreadcrumb(product?.title ?? null);

  const openEdit = useCallback(
    () =>
      void navigate({
        to: "/dashboard/$slug/$id/edit",
        params: { slug: "products", id },
      }),
    [id, navigate],
  );

  const openPage = useCallback(
    (page: string) =>
      void navigate({
        to: "/dashboard/$slug/$id/$page",
        params: { slug: "products", id, page },
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

  if (!product) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 text-center">
        <p className="text-sm text-muted-foreground">
          {result?.message ?? "Product not found"}
        </p>
        <Button variant="outline" size="sm" asChild>
          <Link to="/dashboard/$slug" params={{ slug: "products" }}>
            Back to products
          </Link>
        </Button>
      </div>
    );
  }

  return (
    <PageSplitLayout
      sidebar={
        <div className="flex flex-col gap-4">
          <ProductOrganizationCard
            product={product}
            onEdit={() => openPage("organization")}
          />
          <ProductAttributesCard product={product} />
          <MetadataCard
            slug="products"
            id={product.id}
            keyCount={Object.keys(product.metadata ?? {}).length}
          />
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        <ProductGeneralCard product={product} onEdit={openEdit} />
        <ProductMediaCard product={product} onEdit={() => openPage("media")} />
        {product.options.length > 0 ? (
          <ProductOptionsCard product={product} />
        ) : null}
        <ProductVariantsCard product={product} />
      </div>
    </PageSplitLayout>
  );
};

export default ProductDetail;
