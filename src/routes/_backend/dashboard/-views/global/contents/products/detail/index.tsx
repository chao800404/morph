import { Button } from "@/components/ui/button";
import { usePageBreadcrumb } from "@/routes/_backend/dashboard/-components/breadcrumb/use-page-breadcrumb";
import { PageSplitLayout } from "@/routes/_backend/dashboard/-components/layout/page-split-layout";
import { MetadataCard } from "@/routes/_backend/dashboard/-components/metadata-card/metadata-card";
import { productQueries } from "@queries/product.queries";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { useCallback } from "react";
import { useShallow } from "zustand/react/shallow";
import { useInfoStore } from "@views/features/global-info/use-info-store";
import { deleteProductsAction } from "../product-actions";
import { ProductAttributesCard } from "./product-attributes-card";
import { ProductDetailSkeleton } from "./product-detail-skeleton";
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

  const queryClient = useQueryClient();
  const { data: result, isPending } = useQuery(productQueries.detail(id));
  const product = result?.success ? result.data : null;

  const { setInfoData, setOpen: setInfoOpen } = useInfoStore(
    useShallow((state) => ({
      setInfoData: state.setInfoData,
      setOpen: state.setOpen,
    })),
  );

  usePageBreadcrumb(product?.title ?? null);

  const openEdit = useCallback(
    () =>
      void navigate({
        to: "/dashboard/$slug/$id/edit",
        params: { slug: "products", id },
      }),
    [id, navigate],
  );

  // Deleting the record this page is showing has to leave it: the detail query
  // would refetch into a "not found" state and strand the author here.
  const confirmDelete = useCallback(
    (title: string) => {
      setInfoData({
        title: "Delete Product",
        description: `Are you sure you want to delete "${title}"? Its variants, prices and media links go with it. This action cannot be undone.`,
        fields: [
          { type: "hidden", name: "productIds", value: JSON.stringify([id]) },
        ],
        action: deleteProductsAction,
        confirmLabel: "Delete",
        confirmVariant: "destructive",
        onSuccess: () => {
          void queryClient.invalidateQueries({
            queryKey: productQueries.all(),
          });
          void navigate({
            to: "/dashboard/$slug",
            params: { slug: "products" },
            replace: true,
          });
        },
      });
      setInfoOpen(true);
    },
    [id, navigate, queryClient, setInfoData, setInfoOpen],
  );

  const openPage = useCallback(
    (page: string) =>
      void navigate({
        to: "/dashboard/$slug/$id/$page",
        params: { slug: "products", id, page },
      }),
    [id, navigate],
  );

  // The same component the route uses as its chunk fallback, so the two waits
  // read as one state rather than a spinner that swaps to a skeleton.
  if (isPending) {
    return <ProductDetailSkeleton />;
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
          <ProductAttributesCard
            product={product}
            onEdit={() => openPage("attributes")}
          />
          <MetadataCard
            slug="products"
            id={product.id}
            keyCount={Object.keys(product.metadata ?? {}).length}
          />
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        <ProductGeneralCard
          product={product}
          onEdit={openEdit}
          onDelete={() => confirmDelete(product.title)}
        />
        <ProductMediaCard product={product} onEdit={() => openPage("media")} />
        <ProductOptionsCard
          product={product}
          onEdit={() => openPage("options")}
        />
        <ProductVariantsCard product={product} />
      </div>
    </PageSplitLayout>
  );
};

export default ProductDetail;
