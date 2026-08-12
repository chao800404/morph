import { RouteSurfaceMessage } from "@/components/dialog/route-surface-message";
import {
  RouteFormPage,
  useRouteModalClose,
  type RouteFormState,
} from "@/components/dialog/route-form-modal";
import { RouteSurfacePending } from "@/components/dialog/route-surface-pending";
import type { FormField } from "@/lib/validations/form";
import { productQueries } from "@queries/product.queries";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "@tanstack/react-router";
import { toast } from "sonner";
import { updateProductAction } from "../product-actions";
import { productGeneralFields } from "../config/product-form-fields";

/**
 * The product's own fields.
 *
 * Organization, media and metadata are edited on their own pages: each of them
 * replaces a whole link set, and a single form that did not render them would
 * clear them by omission.
 */
const ProductEdit = () => {
  const { id } = useParams({ strict: false }) as { id: string };
  const queryClient = useQueryClient();
  const close = useRouteModalClose();
  const { data: result, isPending } = useQuery(productQueries.detail(id));

  const submit = async (
    _state: RouteFormState,
    formData: FormData,
  ): Promise<RouteFormState> => {
    formData.set("id", id);
    const response = await updateProductAction({ data: formData });

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

  const fields: FormField[] = [
    ...productGeneralFields({
      title: product.title,
      subtitle: product.subtitle ?? "",
      handle: product.handle,
      description: product.description ?? "",
      mode: "edit",
    }),
    {
      type: "input",
      name: "material",
      label: "Material",
      optional: true,
      value: product.material ?? "",
      placeholder: "e.g. Polyethylene",
    },
    {
      type: "select",
      name: "status",
      label: "Status",
      value: product.status,
      options: [
        { value: "draft", label: "Draft" },
        { value: "published", label: "Published" },
        { value: "archived", label: "Archived" },
      ],
    },
    {
      type: "switch",
      name: "discountable",
      label: "Discountable",
      description: "When off, promotions and discounts never apply.",
      value: product.discountable,
    },
  ];

  return (
    <RouteFormPage
      title="Edit Product"
      description={product.title}
      action={submit}
      submitLabel="Save"
      loadingLabel="Saving..."
      fields={fields}
    />
  );
};

export default ProductEdit;
