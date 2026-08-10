import { DialogFooterActions } from "@/components/dialog/dialog-footer-actions";
import {
  RouteFormModal,
  useCloseOnEscape,
  useRouteModalClose,
  type RouteFormState,
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
import { toMajorUnits } from "@/lib/currency/catalog";
import { currencyQueries } from "@queries/currency.queries";
import {
  productQueries,
  productVariantQueries,
} from "@queries/product.queries";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "@tanstack/react-router";
import { useActionState } from "react";
import { toast } from "sonner";
import { updateVariantPricingAction } from "../product-actions";

const initialState: RouteFormState = { message: "", success: undefined };

/** Medusa-style spreadsheet editor for one variant's multi-currency prices. */
const ProductVariantPricing = () => {
  const { childId: variantId } = useParams({ strict: false }) as {
    childId?: string;
  };
  const close = useRouteModalClose();
  const queryClient = useQueryClient();
  useCloseOnEscape(close);
  const variantQuery = useQuery({
    ...productVariantQueries.detail(
      variantId ?? "00000000-0000-0000-0000-000000000000",
    ),
    enabled: Boolean(variantId),
  });
  const currencyQuery = useQuery(currencyQueries.store());

  const submit = async (
    _state: RouteFormState,
    formData: FormData,
  ): Promise<RouteFormState> => {
    if (!variantId) {
      return { success: false, message: "Missing variant ID" };
    }
    formData.set("id", variantId);
    const response = await updateVariantPricingAction({ data: formData });
    if (!response.success) {
      toast.error(response.message, { position: "top-center" });
      return response;
    }
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: productQueries.all() }),
      queryClient.invalidateQueries({ queryKey: productVariantQueries.all() }),
    ]);
    toast.success(response.message, { position: "top-center" });
    close();
    return response;
  };
  const [, formAction, pending] = useActionState(submit, initialState);

  if (!variantId) {
    return <RouteSurfaceMessage>Missing variant ID</RouteSurfaceMessage>;
  }
  if (variantQuery.isPending || currencyQuery.isPending) {
    return <RouteSurfacePending />;
  }

  const variant = variantQuery.data?.success
    ? variantQuery.data.data.variant
    : null;
  const currencies = currencyQuery.data?.success
    ? currencyQuery.data.data.supportedCurrencies
    : [];
  if (!variant) {
    return (
      <RouteSurfaceMessage>
        {variantQuery.data?.message ?? "Variant not found"}
      </RouteSurfaceMessage>
    );
  }

  return (
    <form action={formAction} className="contents">
      <RouteFormModal
        header={<h2 className="text-sm font-medium">Edit prices</h2>}
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
                <DataGridHead className="min-w-[220px]">Title</DataGridHead>
                {currencies.map((currency) => (
                  <DataGridHead key={currency.code} className="min-w-[160px]">
                    Price {currency.code.toUpperCase()}
                  </DataGridHead>
                ))}
              </DataGridRow>
            </DataGridHeader>
            <DataGridBody>
              <DataGridRow>
                <DataGridCell>
                  <DataGridReadonlyCell>{variant.title}</DataGridReadonlyCell>
                </DataGridCell>
                {currencies.map((currency) => {
                  const price = variant.prices.find(
                    (item) => item.currencyCode === currency.code,
                  );
                  return (
                    <DataGridCell key={currency.code}>
                      <input
                        type="hidden"
                        name={`price-decimals-${currency.code}`}
                        value={currency.decimalDigits}
                      />
                      <div className="relative size-full">
                        <span
                          aria-hidden="true"
                          className="pointer-events-none absolute inset-y-0 left-4 z-10 flex items-center text-sm text-muted-foreground"
                        >
                          {currency.symbolNative}
                        </span>
                        <DataGridInput
                          className="pl-9 text-right"
                          name={`price-${currency.code}`}
                          type="number"
                          min="0"
                          step={10 ** -currency.decimalDigits}
                          defaultValue={
                            price ? toMajorUnits(price.amount, currency) : ""
                          }
                          placeholder={
                            currency.decimalDigits > 0
                              ? `0.${"0".repeat(currency.decimalDigits)}`
                              : "0"
                          }
                          aria-label={`Price ${currency.code.toUpperCase()} for ${variant.title}`}
                        />
                      </div>
                    </DataGridCell>
                  );
                })}
              </DataGridRow>
            </DataGridBody>
          </DataGrid>
        </div>
      </RouteFormModal>
    </form>
  );
};

export default ProductVariantPricing;
