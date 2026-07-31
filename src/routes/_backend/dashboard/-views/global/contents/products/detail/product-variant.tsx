import {
  RouteFormPage,
  useRouteModalClose,
  type RouteFormState,
} from "@/components/dialog/route-form-modal";
import { Spinner } from "@/components/ui/spinner";
import { toMajorUnits } from "@/lib/currency/catalog";
import { variantOptionValue } from "@/lib/product/variant-table";
import type { DashboardSearch } from "@/lib/validations/dashboard-search";
import type { FormField } from "@/lib/validations/form";
import { currencyQueries } from "@queries/currency.queries";
import { productQueries } from "@queries/product.queries";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams, useSearch } from "@tanstack/react-router";
import { toast } from "sonner";
import { updateVariantAction } from "../product-actions";

/**
 * One variant's editor, at /dashboard/products/<id>/variant?variantId=…
 *
 * A route rather than an inline row: prices are one field per store currency,
 * and a table row wide enough to hold them stops being readable. The option
 * values are shown but not editable — changing them would move the variant to a
 * different cell of the matrix, which is a different operation.
 */
const ProductVariant = () => {
  const { id } = useParams({ strict: false }) as { id: string };
  const { variantId } = useSearch({ strict: false }) as DashboardSearch;
  const queryClient = useQueryClient();
  const close = useRouteModalClose();

  const { data: result, isPending } = useQuery(productQueries.detail(id));
  const { data: currencyResult, isPending: currenciesPending } = useQuery(
    currencyQueries.store(),
  );

  const submit = async (
    _state: RouteFormState,
    formData: FormData,
  ): Promise<RouteFormState> => {
    if (!variantId) return { success: false, message: "Missing variant" };
    formData.set("id", variantId);
    const response = await updateVariantAction({ data: formData });

    if (!response.success) {
      toast.error(response.message, { position: "top-center" });
      return response;
    }

    await queryClient.invalidateQueries({ queryKey: productQueries.all() });
    toast.success(response.message, { position: "top-center" });
    close();
    return response;
  };

  if (isPending || currenciesPending) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center">
        <Spinner />
      </div>
    );
  }

  const product = result?.success ? result.data : null;
  const variant = product?.variants.find((row) => row.id === variantId);
  if (!product || !variant) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center">
        <p className="text-sm text-muted-foreground">
          {result?.message ?? "Variant not found"}
        </p>
      </div>
    );
  }

  const currencies = currencyResult?.success
    ? currencyResult.data.supportedCurrencies
    : [];
  const priceOf = (code: string) =>
    variant.prices.find((price) => price.currencyCode === code);

  const fields: FormField[] = [
    {
      type: "input",
      name: "title",
      label: "Title",
      value: variant.title,
      required: true,
      autoFocus: true,
      colSpan: 1,
    },
    {
      type: "input",
      name: "sku",
      label: "SKU",
      optional: true,
      value: variant.sku ?? "",
      colSpan: 1,
    },
    // Read-only context: which cell of the matrix this variant is.
    ...product.options.map(
      (option): FormField => ({
        type: "input",
        name: `option-${option.id}`,
        label: option.title,
        value: variantOptionValue(variant, option) ?? "—",
        disabled: true,
        colSpan: 1,
      }),
    ),
    {
      type: "switch",
      name: "manageInventory",
      label: "Manage inventory",
      description: "Track stock for this variant and stop selling at zero.",
      value: variant.manageInventory,
    },
    {
      type: "switch",
      name: "allowBackorder",
      label: "Allow backorder",
      description: "Keep selling once stock reaches zero.",
      value: variant.allowBackorder,
    },
    {
      type: "input",
      name: "inventoryQuantity",
      label: "Quantity",
      inputType: "number",
      value: String(variant.inventoryQuantity),
      colSpan: 1,
    },
    ...currencies.map(
      (currency): FormField => ({
        type: "input",
        name: `price-${currency.code}`,
        label: `Price ${currency.code.toUpperCase()}`,
        inputType: "number",
        optional: true,
        prefix: currency.code.toUpperCase(),
        value: (() => {
          const price = priceOf(currency.code);
          return price ? String(toMajorUnits(price.amount, currency)) : "";
        })(),
        colSpan: 1,
      }),
    ),
  ];

  return (
    <RouteFormPage
      title="Edit Variant"
      description={`${product.title} — ${variant.title}`}
      action={submit}
      submitLabel="Save"
      loadingLabel="Saving..."
      fields={fields}
      fieldsClassName="sm:grid-cols-2"
    />
  );
};

export default ProductVariant;
