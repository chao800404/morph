import { DialogFooterActions } from "@/components/dialog/dialog-footer-actions";
import {
  RouteFormModal,
  useRouteModalClose,
} from "@/components/dialog/route-form-modal";
import { RouteSurfaceMessage } from "@/components/dialog/route-surface-message";
import { RouteSurfacePending } from "@/components/dialog/route-surface-pending";
import {
  DataGrid,
  DataGridBody,
  DataGridCell,
  DataGridHead,
  DataGridHeader,
  DataGridInput,
  DataGridReadonlyCell,
  DataGridRow,
} from "@/components/ui/data-grid";
import { toMajorUnits, toMinorUnits } from "@/lib/currency/catalog";
import {
  bulkUpdateVariantInventory,
  bulkUpdateVariantPrices,
} from "@/server/product/variants.serverFn";
import { currencyQueries } from "@queries/currency.queries";
import {
  productQueries,
  productVariantQueries,
} from "@queries/product.queries";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";

export const ProductVariantsBulkEditor = ({
  mode,
}: {
  mode: "prices" | "inventory";
}) => {
  const { id } = useParams({ strict: false }) as { id?: string };
  const close = useRouteModalClose();
  const client = useQueryClient();
  const [pending, setPending] = useState(false);
  const productQuery = useQuery(
    productQueries.detail(id ?? "00000000-0000-0000-0000-000000000000"),
  );
  const variantQuery = useQuery(
    productVariantQueries.bulk(id ?? "00000000-0000-0000-0000-000000000000"),
  );
  const currencyQuery = useQuery({
    ...currencyQueries.store(),
    enabled: mode === "prices",
  });
  if (
    productQuery.isPending ||
    variantQuery.isPending ||
    (mode === "prices" && currencyQuery.isPending)
  )
    return <RouteSurfacePending />;
  const product = productQuery.data?.success ? productQuery.data.data : null;
  const variants = variantQuery.data?.success
    ? variantQuery.data.data.variants
    : [];
  const currencyResult = currencyQuery.data;
  const currencies = currencyResult?.success
    ? currencyResult.data.supportedCurrencies
    : [];
  if (!id || !product)
    return (
      <RouteSurfaceMessage>
        {productQuery.data?.message ?? "Product not found"}
      </RouteSurfaceMessage>
    );
  if (variantQuery.data && !variantQuery.data.success)
    return (
      <RouteSurfaceMessage>{variantQuery.data.message}</RouteSurfaceMessage>
    );
  if (variants.length === 0) {
    return <RouteSurfaceMessage>No variants to edit</RouteSurfaceMessage>;
  }
  if (mode === "prices" && currencyResult && !currencyResult.success) {
    return <RouteSurfaceMessage>{currencyResult.message}</RouteSurfaceMessage>;
  }
  if (mode === "prices" && currencies.length === 0) {
    return (
      <RouteSurfaceMessage>
        Enable a store currency before editing prices
      </RouteSurfaceMessage>
    );
  }
  if (
    mode === "inventory" &&
    !variants.some((variant) => variant.manageInventory)
  ) {
    return (
      <RouteSurfaceMessage>
        No inventory-tracked variants to edit
      </RouteSurfaceMessage>
    );
  }

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setPending(true);
    const form = new FormData(event.currentTarget);
    const result =
      mode === "prices"
        ? await bulkUpdateVariantPrices({
            data: {
              productId: id,
              variants: variants.map((variant) => ({
                id: variant.id,
                prices: currencies.flatMap((currency) => {
                  const raw = String(
                    form.get(`${variant.id}:${currency.code}`) ?? "",
                  ).trim();
                  return raw
                    ? [
                        {
                          currencyCode: currency.code,
                          amount: toMinorUnits(Number(raw), currency),
                        },
                      ]
                    : [];
                }),
              })),
            },
          })
        : await bulkUpdateVariantInventory({
            data: {
              productId: id,
              variants: variants
                .filter((variant) => variant.manageInventory)
                .map((variant) => ({
                  id: variant.id,
                  quantity: Number(form.get(variant.id) ?? 0),
                })),
            },
          });
    if (!result.success) {
      setPending(false);
      toast.error(result.message, { position: "top-center" });
      return;
    }
    await client.invalidateQueries({ queryKey: productQueries.all() });
    await client.invalidateQueries({ queryKey: productVariantQueries.all() });
    toast.success(result.message, { position: "top-center" });
    close();
  };

  return (
    <form onSubmit={submit} className="contents">
      <RouteFormModal
        label="Edit variants"
        header={
          <h2 className="text-sm font-medium">
            {mode === "prices" ? "Edit prices" : "Edit inventory"}
          </h2>
        }
        footer={
          <DialogFooterActions
            isSheet={false}
            isLoading={pending}
            onCancel={close}
            submitLabel="Save"
            loadingLabel="Saving..."
          />
        }
      >
        <div className="size-full min-h-0 overflow-auto">
          <DataGrid className="w-auto">
            <DataGridHeader>
              <DataGridRow>
                <DataGridHead className="min-w-[220px]">Variant</DataGridHead>
                {mode === "prices" ? (
                  currencies.map((currency) => (
                    <DataGridHead key={currency.code} className="min-w-[160px]">
                      Price {currency.code.toUpperCase()}
                    </DataGridHead>
                  ))
                ) : (
                  <DataGridHead className="min-w-[180px]">
                    Available quantity
                  </DataGridHead>
                )}
              </DataGridRow>
            </DataGridHeader>
            <DataGridBody>
              {variants.map((variant) => (
                <DataGridRow key={variant.id}>
                  <DataGridCell>
                    <DataGridReadonlyCell>{variant.title}</DataGridReadonlyCell>
                  </DataGridCell>
                  {mode === "prices" ? (
                    currencies.map((currency) => {
                      const price = variant.prices.find(
                        (item) => item.currencyCode === currency.code,
                      );
                      return (
                        <DataGridCell key={currency.code}>
                          <DataGridInput
                            className="text-right"
                            name={`${variant.id}:${currency.code}`}
                            type="number"
                            min="0"
                            step={10 ** -currency.decimalDigits}
                            defaultValue={
                              price ? toMajorUnits(price.amount, currency) : ""
                            }
                            aria-label={`Price ${currency.code} for ${variant.title}`}
                          />
                        </DataGridCell>
                      );
                    })
                  ) : (
                    <DataGridCell>
                      {variant.manageInventory ? (
                        <DataGridInput
                          className="text-right"
                          name={variant.id}
                          type="number"
                          min="0"
                          max="1000000"
                          step="1"
                          defaultValue={variant.inventoryQuantity}
                          aria-label={`Inventory for ${variant.title}`}
                        />
                      ) : (
                        <DataGridReadonlyCell>Not tracked</DataGridReadonlyCell>
                      )}
                    </DataGridCell>
                  )}
                </DataGridRow>
              ))}
            </DataGridBody>
          </DataGrid>
        </div>
      </RouteFormModal>
    </form>
  );
};
