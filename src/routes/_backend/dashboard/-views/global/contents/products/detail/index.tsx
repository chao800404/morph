import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import {
  Table,
  TableBody,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { CardWrapper } from "@/routes/_backend/dashboard/-components/card-wrapper";
import { deleteVariants, updateVariant } from "@/server/product/variants.serverFn";
import { productQueries } from "@queries/product.queries";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { VariantRow, toMinor, type VariantEdit } from "./variant-row";

/**
 * Product detail.
 *
 * Its reason for existing is variant editing: before this page a variant's
 * price, stock and SKU were fixed at creation and could only be changed by
 * deleting the product and building it again.
 */
const STATUS_VARIANT = {
  published: "default",
  draft: "secondary",
  archived: "outline",
} as const;

export const ProductDetail = () => {
  const { id } = useParams({ strict: false }) as { id: string };
  const queryClient = useQueryClient();
  const { data: result, isPending } = useQuery(productQueries.detail(id));

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

  if (isPending) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner />
      </div>
    );
  }

  const product = result?.success ? result.data : null;
  if (!product) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 text-center">
        <p className="text-sm text-muted-foreground">
          {result?.message ?? "Product not found"}
        </p>
        <Button variant="outline" size="sm" asChild>
          <Link to="/dashboard/$slug" params={{ slug: "products" }}>
            Back to products
          </Link>
        </Button>
      </div>
    );
  }

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
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" aria-label="Back" asChild>
          <Link to="/dashboard/$slug" params={{ slug: "products" }}>
            <ArrowLeft className="size-4" />
          </Link>
        </Button>
        <h1 className="text-lg font-medium text-foreground">{product.title}</h1>
        <Badge variant={STATUS_VARIANT[product.status]}>{product.status}</Badge>
        <span className="text-sm text-muted-foreground">/{product.handle}</span>
      </div>

      {product.options.length > 0 && (
        <CardWrapper
          label="Options"
          description="The axes this product's variants are built from. Editing them would rebuild the matrix, so they are fixed after creation."
        >
          <div className="flex flex-col gap-3 px-6 pb-6">
            {product.options.map((option) => (
              <div key={option.id} className="flex items-baseline gap-3">
                <span className="w-32 shrink-0 text-sm font-medium text-foreground">
                  {option.title}
                </span>
                <div className="flex flex-wrap gap-1.5">
                  {option.values.map((value) => (
                    <Badge key={value.id} variant="secondary">
                      {value.value}
                    </Badge>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </CardWrapper>
      )}

      <CardWrapper
        label="Variants"
        description={`${product.variants.length} variant${product.variants.length === 1 ? "" : "s"}. Changes are saved per row.`}
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
                    // Remount when the server's copy changes, so the row's
                    // local edits reset to what was actually saved.
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
    </div>
  );
};

export default ProductDetail;
