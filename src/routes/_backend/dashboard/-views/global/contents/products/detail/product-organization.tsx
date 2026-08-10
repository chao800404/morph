import { RouteSurfaceMessage } from "@/components/dialog/route-surface-message";
import {
  RouteFormPage,
  useRouteModalClose,
  type RouteFormState,
} from "@/components/dialog/route-form-modal";
import { RouteSurfacePending } from "@/components/dialog/route-surface-pending";
import { categoryDepth } from "@/lib/product/category-tree";
import type { FormField } from "@/lib/validations/form";
import {
  collectionQueries,
  normalizeCollectionListParams,
  productQueries,
  productTaxonomyQueries,
} from "@queries/product.queries";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "@tanstack/react-router";
import { toast } from "sonner";
import {
  normalizeSalesChannelListParams,
  salesChannelQueries,
} from "@queries/sales-channel.queries";
import {
  NO_COLLECTION,
  updateProductOrganizationAction,
} from "../product-actions";

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
  const { data: taxonomyResult, isPending: taxonomyPending } = useQuery(
    productTaxonomyQueries.list(),
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

  if (isPending || collectionsPending || taxonomyPending || channelsPending) {
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
  const taxonomy = taxonomyResult?.success ? taxonomyResult.data : null;
  const toValueChoices = (values: { value: string }[]) =>
    values.map(({ value }) => ({ id: value, value }));
  const categories = taxonomy?.categories ?? [];
  const salesChannels = channelResult?.success
    ? (channelResult.data?.salesChannels ?? [])
    : [];

  const fields: FormField[] = [
    {
      type: "select",
      name: "collectionId",
      label: "Collection",
      optional: true,
      value: product.collectionId || NO_COLLECTION,
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
      value: product.typeValue ? [product.typeValue] : [],
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
      value: product.tags.map((tag) => tag.value),
      allowCreate: true,
      placeholder: "Select or create tags...",
      searchPlaceholder: "Search tags...",
      emptyMessage: "No tag found.",
      colSpan: 1,
    },
    {
      type: "option-values",
      name: "categoryIds",
      label: "Categories",
      optional: true,
      choices: categories.map((category) => ({
        id: category.id,
        value: `${"— ".repeat(categoryDepth(category.mpath))}${category.name}`,
      })),
      value: product.categoryIds,
      placeholder: "Select categories...",
      searchPlaceholder: "Search categories...",
      emptyMessage: "No category found.",
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
      value: product.salesChannelIds,
      placeholder: "Select sales channels...",
      searchPlaceholder: "Search sales channels...",
      emptyMessage: "No sales channel found.",
      colSpan: 1,
    },
  ];

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
