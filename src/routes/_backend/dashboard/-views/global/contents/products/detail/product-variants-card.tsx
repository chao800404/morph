import {
  Table,
  TableBody,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { ProductDetailDTO } from "@/lib/product/dto/product.dto";
import { CardWrapper } from "@/routes/_backend/dashboard/-components/card-wrapper";
import { productQueries } from "@queries/product.queries";
import {
  deleteVariants,
  updateVariant,
} from "@/server/product/variants.serverFn";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { VariantRow, toMinor, type VariantEdit } from "./variant-row";

/**
 * The variant matrix, editable in place.
 *
 * This is the page's reason for existing: before it, a variant's price, stock
 * and SKU were fixed at creation and could only be changed by deleting the
 * product and building it again. Medusa puts variants in a paginated data
 * table; here the rows are the editor, so they stay on one page.
 */
export const ProductVariantsCard = ({
  product,
}: {
  product: ProductDetailDTO;
}) => {
  const queryClient = useQueryClient();

  // Which row is mid-request, so only that row shows a spinner.
  const [busyId, setBusyId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: productQueries.all() });

  const save = useMutation({
    mutationFn: async ({
      variantId,
      edit,
    }: {
      variantId: string;
      edit: VariantEdit;
    }) =>
      updateVariant({
        data: {
          id: variantId,
          title: edit.title.trim(),
          sku: edit.sku.trim() || null,
          manageInventory: edit.manageInventory,
          allowBackorder: edit.allowBackorder,
          inventoryQuantity: Math.max(
            0,
            Math.floor(Number(edit.inventoryQuantity) || 0),
          ),
          prices: Object.entries(edit.prices)
            .map(([currencyCode, value]) => ({
              currencyCode,
              amount: toMinor(value),
            }))
            .filter((price) => price.amount > 0),
        },
      }),
    onSettled: () => setBusyId(null),
    onSuccess: async (response) => {
      if (!response.success) {
        toast.error(response.message, { position: "top-center" });
        return;
      }
      await refresh();
      toast.success("Variant updated", { position: "top-center" });
    },
    onError: (error: Error) =>
      toast.error(error.message, { position: "top-center" }),
  });

  const remove = useMutation({
    mutationFn: async (variantId: string) =>
      deleteVariants({ data: { ids: [variantId] } }),
    onSettled: () => setDeletingId(null),
    onSuccess: async (response) => {
      if (!response.success) {
        toast.error(response.message, { position: "top-center" });
        return;
      }
      await refresh();
      toast.success("Variant deleted", { position: "top-center" });
    },
    onError: (error: Error) =>
      toast.error(error.message, { position: "top-center" }),
  });

  // Every currency any variant is priced in, so a variant missing one still
  // gets an empty field to fill rather than silently having no column.
  const currencies = [
    ...new Set(
      product.variants.flatMap((variant) =>
        variant.prices.map((price) => price.currencyCode),
      ),
    ),
  ].sort();

  return (
    <CardWrapper
      id="product-variants"
      label="Variants"
      description={`${product.variants.length} variant${
        product.variants.length === 1 ? "" : "s"
      }. Changes are saved per row.`}
    >
      {product.variants.length === 0 ? (
        <p className="px-6 pb-6 text-sm text-muted-foreground">
          This product has no variants.
        </p>
      ) : (
        <div className="overflow-x-auto px-6 pb-6">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="min-w-[180px]">Title</TableHead>
                <TableHead className="min-w-[140px]">SKU</TableHead>
                <TableHead className="w-32 text-center">
                  Managed inventory
                </TableHead>
                <TableHead className="w-28 text-center">
                  Allow backorder
                </TableHead>
                <TableHead className="w-28">Quantity</TableHead>
                {currencies.map((currency) => (
                  <TableHead key={currency} className="min-w-[120px]">
                    Price {currency.toUpperCase()}
                  </TableHead>
                ))}
                <TableHead className="w-24 pr-6" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {product.variants.map((variant) => (
                <VariantRow
                  // Remount when the server's copy changes, so the row's local
                  // edits reset to what was actually saved.
                  key={`${variant.id}-${variant.updatedAt}`}
                  variant={variant}
                  currencies={currencies}
                  isSaving={busyId === variant.id}
                  isDeleting={deletingId === variant.id}
                  onSave={(edit) => {
                    setBusyId(variant.id);
                    save.mutate({ variantId: variant.id, edit });
                  }}
                  onDelete={() => {
                    setDeletingId(variant.id);
                    remove.mutate(variant.id);
                  }}
                />
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </CardWrapper>
  );
};
