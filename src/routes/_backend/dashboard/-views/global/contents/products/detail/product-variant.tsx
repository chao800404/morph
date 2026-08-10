import { RouteSurfaceMessage } from "@/components/dialog/route-surface-message";
import {
  RouteFormPage,
  useRouteModalClose,
  type RouteFormState,
} from "@/components/dialog/route-form-modal";
import { RouteSurfacePending } from "@/components/dialog/route-surface-pending";
import { toMajorUnits } from "@/lib/currency/catalog";
import type { DashboardSearch } from "@/lib/validations/dashboard-search";
import type { FormField } from "@/lib/validations/form";
import { currencyQueries } from "@queries/currency.queries";
import { productQueries } from "@queries/product.queries";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams, useSearch } from "@tanstack/react-router";
import { toast } from "sonner";
import { useLayoutEffect } from "react";
import { serializeSelectedAssets } from "@/components/form/asset-select-field";
import { createVariantAction, updateVariantAction } from "../product-actions";

/**
 * One variant's editor, at /dashboard/products/<id>/variant.
 *
 * `?variantId` picks the variant to edit; without it the page creates one. Two
 * modes on one surface rather than two routes, the way the Assets create page
 * serves folders and uploads — it is the same form, and only the option values
 * change from readable to choosable.
 *
 * A route rather than an inline row: prices are one field per store currency,
 * and a table row wide enough to hold them stops being readable.
 *
 * Editing can change the option values: adding an option axis later leaves the
 * variants that predate it with no value on that axis, and this is where the
 * gap is filled. The server refuses a combination another variant already has.
 */
const ProductVariant = () => {
  const { id } = useParams({ strict: false }) as { id: string };
  const { variantId, editSection } = useSearch({
    strict: false,
  }) as DashboardSearch;
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
    let response;
    if (variantId) {
      formData.set("id", variantId);
      response = await updateVariantAction({ data: formData });
    } else {
      formData.set("productId", id);
      response = await createVariantAction({ data: formData });
    }

    if (!response.success) {
      toast.error(response.message, { position: "top-center" });
      return response;
    }

    await queryClient.invalidateQueries({ queryKey: productQueries.all() });
    toast.success(response.message, { position: "top-center" });
    close();
    return response;
  };

  const product = result?.success ? result.data : null;
  const variant = variantId
    ? product?.variants.find((row) => row.id === variantId)
    : undefined;
  const currencies = currencyResult?.success
    ? currencyResult.data.supportedCurrencies
    : [];

  useLayoutEffect(() => {
    if (!editSection || isPending || currenciesPending) return;
    const fieldName = {
      general: "title",
      media: product?.options.length ? "assets" : "title",
      inventory: "inventoryQuantity",
    }[editSection];
    const frame = window.requestAnimationFrame(() => {
      document
        .getElementById(`field-${fieldName}-wrapper`)
        ?.scrollIntoView({ block: "start", behavior: "smooth" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [currencies, currenciesPending, editSection, isPending, product]);

  if (isPending || currenciesPending) {
    return <RouteSurfacePending />;
  }

  if (!product || (variantId && !variant)) {
    return (
      <RouteSurfaceMessage>
        {result?.message ?? "Variant not found"}
      </RouteSurfaceMessage>
    );
  }

  const priceOf = (code: string) =>
    variant?.prices.find((price) => price.currencyCode === code);

  const fields: FormField[] = [
    {
      type: "input",
      name: "title",
      label: "Title",
      value: variant?.title ?? "",
      required: true,
      autoFocus: true,
      colSpan: 1,
    },
    {
      type: "input",
      name: "sku",
      label: "SKU",
      optional: true,
      value: variant?.sku ?? "",
      colSpan: 1,
    },
    {
      type: "input",
      name: "barcode",
      label: "Barcode",
      optional: true,
      value: variant?.barcode ?? "",
      labelHint:
        "EAN, UPC or another scannable code. Must be unique across variants.",
      colSpan: 1,
    },
    // Which cell of the matrix this variant occupies.
    ...product.options.map((option): FormField => {
      const owned = new Set(option.values.map((value) => value.id));
      return {
        type: "select",
        name: `option-${option.id}`,
        label: option.title,
        required: true,
        // Empty for a variant that predates this axis, which is exactly the
        // case this field exists to fix.
        value: variant?.optionValueIds.find((id) => owned.has(id)) ?? "",
        options: option.values.map((value) => ({
          value: value.id,
          label: value.value,
        })),
        colSpan: 1,
      };
    }),
    ...(product.options.length > 0
      ? [
          {
            type: "asset-select" as const,
            name: "assets",
            label: "Media",
            optional: true,
            labelHint:
              "Choose from Product Media. The first image is this variant's thumbnail.",
            value: serializeSelectedAssets(variant?.assets ?? []),
            availableAssets: product.assets,
          },
        ]
      : []),
    {
      type: "switch",
      name: "manageInventory",
      label: "Manage inventory",
      description: "Track stock for this variant and stop selling at zero.",
      value: variant?.manageInventory ?? true,
    },
    {
      type: "switch",
      name: "allowBackorder",
      label: "Allow backorder",
      description: "Keep selling once stock reaches zero.",
      value: variant?.allowBackorder ?? false,
    },
    {
      type: "input",
      name: "inventoryQuantity",
      label: "Quantity",
      inputType: "number",
      value: String(variant?.inventoryQuantity ?? 0),
      colSpan: 1,
    },
    ...(["height", "width", "length", "weight"] as const).map(
      (name): FormField => ({
        type: "input",
        name,
        label: name[0].toUpperCase() + name.slice(1),
        inputType: "number",
        // Decimals are legitimate measurements; the default step rejects them.
        step: "any",
        optional: true,
        suffix: name === "weight" ? "g" : "mm",
        // Blank, not the product's value: an empty field means "inherit the
        // product's", and pre-filling it would turn the first save into a copy
        // that then stops following the product.
        value: variant?.[name] === null ? "" : String(variant?.[name] ?? ""),
        labelHint: "Overrides the product's value. Leave blank to inherit it.",
        colSpan: 1,
      }),
    ),
    ...(variant
      ? []
      : currencies.flatMap((currency): FormField[] => [
          {
            type: "hidden",
            name: `price-decimals-${currency.code}`,
            value: String(currency.decimalDigits),
          },
          {
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
          },
        ])),
  ];

  return (
    <RouteFormPage
      title={variant ? "Edit Variant" : "Create Variant"}
      description={
        variant ? `${product.title} — ${variant.title}` : product.title
      }
      action={submit}
      submitLabel={variant ? "Save" : "Create"}
      loadingLabel={variant ? "Saving..." : "Creating..."}
      fields={fields}
      fieldsClassName="sm:grid-cols-2"
    />
  );
};

export default ProductVariant;
