import { RouteSurfaceMessage } from "@/components/dialog/route-surface-message";
import {
  RouteFormPage,
  useRouteModalClose,
  type RouteFormState,
} from "@/components/dialog/route-form-modal";
import { RouteSurfacePending } from "@/components/dialog/route-surface-pending";
import { variantsUsingOptions } from "@/lib/product/variant-table";
import { MAX_PRODUCT_OPTIONS } from "@/lib/validations/product";
import type { FormField } from "@/lib/validations/form";
import {
  normalizeProductOptionListParams,
  productOptionQueries,
  productQueries,
  productVariantQueries,
} from "@queries/product.queries";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "@tanstack/react-router";
import { toast } from "sonner";
import { useShallow } from "zustand/react/shallow";
import { useInfoStore } from "@views/features/global-info/use-info-store";
import { setProductOptionsAction } from "../product-actions";

/**
 * Add option axes to a product, at /dashboard/products/<id>/options.
 *
 * Additive only. Removing an axis would orphan the option value ids every
 * existing variant stores, so the ones already attached are shown as fixed and
 * the field offers the rest of the library.
 *
 * A variant that predates a new axis has no value on it — the Variants table
 * shows a dash, and its editor is where the gap is filled.
 */
const ProductOptions = () => {
  const { id } = useParams({ strict: false }) as { id: string };
  const queryClient = useQueryClient();
  const close = useRouteModalClose();
  const { setInfoData, setOpen: setInfoOpen } = useInfoStore(
    useShallow((state) => ({
      setInfoData: state.setInfoData,
      setOpen: state.setOpen,
    })),
  );

  const { data: result, isPending } = useQuery(productQueries.detail(id));
  const { data: libraryResult, isPending: libraryPending } = useQuery(
    productOptionQueries.list(normalizeProductOptionListParams()),
  );
  const { data: variantResult, isPending: variantsPending } = useQuery(
    productVariantQueries.bulk(id),
  );

  const library = libraryResult?.success
    ? (libraryResult.data?.options ?? [])
    : [];
  const variants = variantResult?.success ? variantResult.data.variants : [];

  const submit = async (
    _state: RouteFormState,
    formData: FormData,
  ): Promise<RouteFormState> => {
    formData.set("productId", id);

    const raw = formData.get("optionIds");
    const optionIds: string[] =
      typeof raw === "string" && raw ? (JSON.parse(raw) as string[]) : [];

    // The field submits option ids; the server needs each option's values too,
    // and only this page has the library loaded to expand them. A product takes
    // every value of an option — narrowing happens per variant.
    formData.set(
      "optionSelections",
      JSON.stringify(
        optionIds.flatMap((optionId) => {
          const option = library.find((entry) => entry.id === optionId);
          return option
            ? [{ optionId, valueIds: option.values.map((value) => value.id) }]
            : [];
        }),
      ),
    );
    // Removing an axis that variants use destroys them, so it goes through the
    // shared confirmation with the count rather than happening on Save.
    const removedIds = (product?.options ?? [])
      .filter((option) => !optionIds.includes(option.id))
      .map((option) => option.id);
    const doomed = variantsUsingOptions(
      product?.options ?? [],
      variants,
      removedIds,
    );

    if (doomed.length > 0) {
      const removedTitles = (product?.options ?? [])
        .filter((option) => removedIds.includes(option.id))
        .map((option) => option.title)
        .join(", ");

      setInfoData({
        title: "Remove Options",
        description: `Removing ${removedTitles} deletes ${doomed.length} variant${
          doomed.length === 1 ? "" : "s"
        } — without that axis they would collapse onto each other, and their prices and stock cannot be merged. Variants for the remaining axes are then created fresh, with no prices. This action cannot be undone.`,
        fields: [
          { type: "hidden", name: "productId", value: id },
          {
            type: "hidden",
            name: "optionSelections",
            value: String(formData.get("optionSelections") ?? "[]"),
          },
          { type: "hidden", name: "removeVariantsInUse", value: "on" },
        ],
        action: setProductOptionsAction,
        confirmLabel: `Delete ${doomed.length} and remove`,
        confirmVariant: "destructive",
        onSuccess: () => {
          void queryClient.invalidateQueries({
            queryKey: productQueries.all(),
          });
          void queryClient.invalidateQueries({
            queryKey: productVariantQueries.all(),
          });
          close();
        },
      });
      setInfoOpen(true);
      return { success: false, message: "" };
    }

    const response = await setProductOptionsAction({ data: formData });

    if (!response.success) {
      toast.error(response.message, { position: "top-center" });
      return response;
    }

    await Promise.all([
      queryClient.invalidateQueries({ queryKey: productQueries.all() }),
      queryClient.invalidateQueries({
        queryKey: productVariantQueries.all(),
      }),
    ]);
    toast.success(response.message, { position: "top-center" });
    close();
    return response;
  };

  if (isPending || libraryPending || variantsPending) {
    return <RouteSurfacePending />;
  }

  const product = result?.success ? result.data : null;
  if (!product || (variantResult && !variantResult.success)) {
    return (
      <RouteSurfaceMessage>
        {variantResult?.message ?? result?.message ?? "Product not found"}
      </RouteSurfaceMessage>
    );
  }

  const attachedIds = product.options.map((option) => option.id);
  const attached = new Set(attachedIds);

  // The field shows the product's whole axis set, with the current ones already
  // ticked, so it reads as "these are this product's options" rather than "here
  // are some extras". Unticking one is caught on submit rather than ignored.
  const choices = [
    ...product.options.map((option) => ({
      id: option.id,
      value: option.title,
    })),
    ...library
      .filter((option) => !attached.has(option.id))
      .map((option) => ({ id: option.id, value: option.title })),
  ];

  const fields: FormField[] = [
    {
      type: "tip",
      name: "existing",
      label: "Changing the axes:",
      description:
        "Saving fills in a variant for every combination these axes describe; the ones that already exist keep their prices and stock. Variants that predate a new axis hold no value on it — the table shows a dash, and their editor is where you set one.",
    },
    {
      type: "option-values",
      name: "optionIds",
      label: "Options",
      choices,
      value: attachedIds,
      maxSelected: MAX_PRODUCT_OPTIONS,
      placeholder: "Select options...",
      searchPlaceholder: "Search options...",
      emptyMessage: "No option found.",
    },
  ];

  return (
    <RouteFormPage
      title="Add Options"
      description={product.title}
      action={submit}
      submitLabel="Add"
      loadingLabel="Adding..."
      fields={fields}
    />
  );
};

export default ProductOptions;
