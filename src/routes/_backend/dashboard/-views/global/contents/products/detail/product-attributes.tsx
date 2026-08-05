import {
  RouteFormPage,
  useRouteModalClose,
  type RouteFormState,
} from "@/components/dialog/route-form-modal";
import { RouteSurfaceMessage } from "@/components/dialog/route-surface-message";
import { RouteSurfacePending } from "@/components/dialog/route-surface-pending";
import type { FormField } from "@/lib/validations/form";
import { productQueries } from "@queries/product.queries";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "@tanstack/react-router";
import { toast } from "sonner";
import { updateProductAttributesAction } from "../product-actions";

/**
 * Shipping and customs, at /dashboard/products/<id>/attributes.
 *
 * The columns and the read-only card existed from the start; nothing could
 * write them, so every product showed a card of dashes. These are the product's
 * defaults — a variant may override each one.
 *
 * Dimensions are millimetres and grams, stored as `real` so 12.5 mm survives —
 * Medusa models them as floats for the same reason.
 */
const ProductAttributes = () => {
  const { id } = useParams({ strict: false }) as { id: string };
  const queryClient = useQueryClient();
  const close = useRouteModalClose();

  const { data: result, isPending } = useQuery(productQueries.detail(id));

  const submit = async (
    _state: RouteFormState,
    formData: FormData,
  ): Promise<RouteFormState> => {
    formData.set("id", id);
    const response = await updateProductAttributesAction({ data: formData });

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

  const measurement = (
    name: "height" | "width" | "length" | "weight",
    label: string,
    unit: string,
  ): FormField => ({
    type: "input",
    name,
    label,
    inputType: "number",
    // Decimals are legitimate measurements; the default step would reject them.
    step: "any",
    optional: true,
    suffix: unit,
    value: product[name] === null ? "" : String(product[name]),
    colSpan: 1,
  });

  const fields: FormField[] = [
    measurement("height", "Height", "mm"),
    measurement("width", "Width", "mm"),
    measurement("length", "Length", "mm"),
    measurement("weight", "Weight", "g"),
    {
      type: "input",
      name: "midCode",
      label: "MID code",
      optional: true,
      value: product.midCode ?? "",
      labelHint:
        "Manufacturer Identification code, used on United States customs entries.",
      colSpan: 1,
    },
    {
      type: "input",
      name: "hsCode",
      label: "HS code",
      optional: true,
      value: product.hsCode ?? "",
      labelHint:
        "Harmonised System code — the tariff classification carriers use to calculate duty.",
      colSpan: 1,
    },
    {
      type: "input",
      name: "originCountry",
      label: "Country of origin",
      optional: true,
      value: product.originCountry ?? "",
      placeholder: "TW",
      labelHint: "Two-letter ISO 3166-1 country code, e.g. TW, US, DE.",
      colSpan: 1,
    },
  ];

  return (
    <RouteFormPage
      title="Edit Attributes"
      description={product.title}
      action={submit}
      submitLabel="Save"
      loadingLabel="Saving..."
      fields={fields}
      fieldsClassName="sm:grid-cols-2"
    />
  );
};

export default ProductAttributes;
