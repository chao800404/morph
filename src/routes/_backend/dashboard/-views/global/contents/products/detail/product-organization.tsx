import { RouteSurfaceMessage } from "@/components/dialog/route-surface-message";
import {
  RouteFormPage,
  useRouteModalClose,
  type RouteFormState,
} from "@/components/dialog/route-form-modal";
import { RouteSurfacePending } from "@/components/dialog/route-surface-pending";
import {
  collectionQueries,
  normalizeCollectionListParams,
  productQueries,
} from "@queries/product.queries";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "@tanstack/react-router";
import { toast } from "sonner";
import {
  normalizeSalesChannelListParams,
  salesChannelQueries,
} from "@queries/sales-channel.queries";
import { updateProductOrganizationAction } from "../product-actions";
import { productOrganizationFields } from "../config/product-form-fields";

/**
 * Where the product sits in the catalogue, at
 * /dashboard/products/<id>/organization.
 *
 * The same four choices the create wizard's Organize step offers, and the same
 * field types — types and tags are identified by value because the server
 * upserts them, categories by id because they are a tree that already exists.
 */
const ProductOrganization = () => {
  const { id } = useParams({ strict: false }) as { id: string };
  const queryClient = useQueryClient();
  const close = useRouteModalClose();

  const { data: result, isPending } = useQuery(productQueries.detail(id));
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

  const submit = async (
    _state: RouteFormState,
    formData: FormData,
  ): Promise<RouteFormState> => {
    formData.set("id", id);
    const response = await updateProductOrganizationAction({ data: formData });

    if (!response.success) {
      toast.error(response.message, { position: "top-center" });
      return response;
    }

    await queryClient.invalidateQueries({ queryKey: productQueries.all() });
    toast.success(response.message, { position: "top-center" });
    close();
    return response;
  };

  if (isPending || collectionsPending || channelsPending) {
    return <RouteSurfacePending />;
  }

  const product = result?.success ? result.data : null;
  if (!product) {
    return (
      <RouteSurfaceMessage>
        {result?.message ?? "Product not found"}
      </RouteSurfaceMessage>
    );
  }

  const collections = collectionResult?.success
    ? (collectionResult.data?.collections ?? [])
    : [];
  const salesChannels = channelResult?.success
    ? (channelResult.data?.salesChannels ?? [])
    : [];

  const fields = productOrganizationFields({
    collectionId: product.collectionId,
    collections,
    typeValue: product.typeValue,
    types: product.typeValue ? [{ value: product.typeValue }] : [],
    tagValues: product.tags.map((tag) => tag.value),
    tags: product.tags.map((tag) => ({ value: tag.value })),
    categoryIds: product.categoryIds,
    categories: product.categories.map((category) => ({
      ...category,
      mpath: null,
    })),
    salesChannelIds: product.salesChannelIds,
    salesChannels,
  });

  return (
    <RouteFormPage
      title="Edit Organization"
      description={product.title}
      action={submit}
      submitLabel="Save"
      loadingLabel="Saving..."
      fields={fields}
      fieldsClassName="sm:grid-cols-2"
    />
  );
};

export default ProductOrganization;
