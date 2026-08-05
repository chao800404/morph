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

  if (isPending || collectionsPending || taxonomyPending) {
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
    />
  );
};

export default ProductOrganization;
