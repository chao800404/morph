import {
  RouteFormPage,
  useRouteModalClose,
  type RouteFormState,
} from "@/components/dialog/route-form-modal";
import { serializeSelectedAssets } from "@/components/form/asset-select-field";
import { Spinner } from "@/components/ui/spinner";
import type { FormField } from "@/lib/validations/form";
import { productQueries } from "@queries/product.queries";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "@tanstack/react-router";
import { toast } from "sonner";
import { updateProductMediaAction } from "../product-actions";

/**
 * The gallery editor, at /dashboard/products/<id>/media.
 *
 * The same `asset-select` field the create wizard uses, so uploading and
 * picking from the library behave identically before and after the product
 * exists.
 */
const ProductMedia = () => {
  const { id } = useParams({ strict: false }) as { id: string };
  const queryClient = useQueryClient();
  const close = useRouteModalClose();
  const { data: result, isPending } = useQuery(productQueries.detail(id));

  const submit = async (
    _state: RouteFormState,
    formData: FormData,
  ): Promise<RouteFormState> => {
    formData.set("id", id);
    const response = await updateProductMediaAction({ data: formData });

    if (!response.success) {
      toast.error(response.message, { position: "top-center" });
      return response;
    }

    await queryClient.invalidateQueries({ queryKey: productQueries.all() });
    toast.success(response.message, { position: "top-center" });
    close();
    return response;
  };

  if (isPending) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center">
        <Spinner />
      </div>
    );
  }

  const product = result?.success ? result.data : null;
  if (!product) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center">
        <p className="text-sm text-muted-foreground">
          {result?.message ?? "Product not found"}
        </p>
      </div>
    );
  }

  const fields: FormField[] = [
    {
      type: "asset-select",
      name: "assets",
      label: "Media",
      optional: true,
      labelHint:
        "The first image becomes the thumbnail shown in lists and on the storefront.",
      value: serializeSelectedAssets(product.assets),
    },
  ];

  return (
    <RouteFormPage
      title="Edit Media"
      description={product.title}
      action={submit}
      submitLabel="Save"
      loadingLabel="Saving..."
      fields={fields}
    />
  );
};

export default ProductMedia;
