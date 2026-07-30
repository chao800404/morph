import {
  RouteFormPage,
  useRouteModalClose,
  type RouteFormState,
} from "@/components/dialog/route-form-modal";
import { handleField } from "@/components/form/handle-field";
import { Spinner } from "@/components/ui/spinner";
import type { FormField } from "@/lib/validations/form";
import { productQueries } from "@queries/product.queries";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "@tanstack/react-router";
import { toast } from "sonner";
import { updateProductAction } from "../product-actions";

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
      type: "input",
      name: "title",
      label: "Title",
      value: product.title,
      required: true,
      autoFocus: true,
    },
    {
      type: "input",
      name: "subtitle",
      label: "Subtitle",
      optional: true,
      value: product.subtitle ?? "",
    },
    handleField({ derivedFrom: "title", value: product.handle }),
    {
      type: "textarea",
      name: "description",
      label: "Description",
      optional: true,
      value: product.description ?? "",
      rows: 4,
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
