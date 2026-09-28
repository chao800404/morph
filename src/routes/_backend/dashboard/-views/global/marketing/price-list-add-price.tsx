import { DialogFooterActions } from "@/components/dialog/dialog-footer-actions";
import { RouteFormModal, useCloseOnEscape, useRouteModalClose, type RouteFormState } from "@/components/dialog/route-form-modal";
import { RouteSurfaceMessage } from "@/components/dialog/route-surface-message";
import { RouteSurfacePending } from "@/components/dialog/route-surface-pending";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toMinorUnits } from "@/lib/currency/catalog";
import { currencyQueries } from "@queries/currency.queries";
import { priceListQueries } from "@queries/price-list.queries";
import { savePriceListPrice } from "@/server/pricing/price-lists.serverFn";
import { useDeferredValue, useActionState, useState } from "react";
import { useParams } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

const initialState: RouteFormState = { message: "", success: undefined };

export default function PriceListAddPrice() {
  const { id: priceListId } = useParams({ strict: false }) as { id: string };
  const close = useRouteModalClose();
  const queryClient = useQueryClient();
  useCloseOnEscape(close);
  const [query, setQuery] = useState("");
  const [selectedCurrencyCode, setSelectedCurrencyCode] = useState<string>();
  const deferredQuery = useDeferredValue(query.trim());
  const [variant, setVariant] = useState<{ id: string; productTitle: string; title: string; sku: string | null; optionValues: string | null } | null>(null);
  const variantsQuery = useQuery(priceListQueries.searchVariants(deferredQuery));
  const currencyQuery = useQuery(currencyQueries.store());
  const priceListQuery = useQuery(priceListQueries.detail(priceListId));
  const currencies = currencyQuery.data?.success ? currencyQuery.data.data.supportedCurrencies : [];
  const defaultCurrency = currencies.find((currency) => currency.isDefault)?.code ?? currencies[0]?.code;
  const currencyCode = selectedCurrencyCode ?? defaultCurrency;
  const selectedCurrency = currencies.find((currency) => currency.code === currencyCode);

  const submit = async (_state: RouteFormState, formData: FormData): Promise<RouteFormState> => {
    const formCurrency = currencies.find((currency) => currency.code === String(formData.get("currencyCode")));
    const majorAmount = Number(formData.get("amount"));
    const minQuantityValue = String(formData.get("minQuantity") ?? "").trim();
    const maxQuantityValue = String(formData.get("maxQuantity") ?? "").trim();
    if (!variant) {
      const failure = { success: false as const, message: "Select a product variant first" };
      toast.error(failure.message, { position: "top-center" });
      return failure;
    }
    if (!formCurrency || !Number.isFinite(majorAmount) || majorAmount < 0) {
      const failure = { success: false as const, message: "Enter a valid price and currency" };
      toast.error(failure.message, { position: "top-center" });
      return failure;
    }
    const response = await savePriceListPrice({
      data: {
        priceListId,
        variantId: variant.id,
        currencyCode: formCurrency.code,
        amount: toMinorUnits(majorAmount, formCurrency),
        minQuantity: minQuantityValue ? Number(minQuantityValue) : undefined,
        maxQuantity: maxQuantityValue ? Number(maxQuantityValue) : undefined,
      },
    });
    if (!response.success) {
      toast.error(response.message, { position: "top-center" });
      return response;
    }
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: priceListQueries.all() }),
      queryClient.invalidateQueries({ queryKey: ["store-catalog"] }),
    ]);
    toast.success(response.message, { position: "top-center" });
    close();
    return response;
  };
  const [, formAction, pending] = useActionState(submit, initialState);

  if (currencyQuery.isPending || priceListQuery.isPending) return <RouteSurfacePending />;
  if (!priceListQuery.data?.success) return <RouteSurfaceMessage>{priceListQuery.data?.message ?? "Price list not found"}</RouteSurfaceMessage>;
  if (currencies.length === 0) return <RouteSurfaceMessage>No supported store currencies are configured.</RouteSurfaceMessage>;

  return (
    <form action={formAction} className="contents">
      <RouteFormModal
        label={`Add price to ${priceListQuery.data.data.title}`}
        header={<h2 className="text-sm font-medium">Add variant price</h2>}
        footer={<DialogFooterActions isSheet={false} isLoading={pending} isDisabled={!variant} onCancel={close} submitLabel="Add price" loadingLabel="Adding..." />}
      >
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 p-6">
          <div className="space-y-2">
            <Label htmlFor="variant-search">Product variant</Label>
            <Input id="variant-search" variant="card" value={query} onChange={(event) => { setQuery(event.target.value); setVariant(null); }} placeholder="Search by product, variant, or SKU" />
            {variant ? (
              <div className="rounded-md border bg-muted/30 p-3 text-sm">
                <div className="font-medium">{variant.productTitle} — {variant.title}</div>
                <div className="text-muted-foreground">{[variant.optionValues, variant.sku].filter(Boolean).join(" · ")}</div>
                <button type="button" className="mt-2 text-xs text-primary underline" onClick={() => setVariant(null)}>Choose another variant</button>
              </div>
            ) : deferredQuery ? (
              <div className="max-h-72 overflow-auto rounded-md border">
                {variantsQuery.isPending ? <p className="p-3 text-sm text-muted-foreground">Searching…</p> : null}
                {variantsQuery.data?.success && variantsQuery.data.data.variants.length === 0 ? <p className="p-3 text-sm text-muted-foreground">No matching variants.</p> : null}
                {variantsQuery.data?.success ? variantsQuery.data.data.variants.map((item) => (
                  <button key={item.id} type="button" className="flex w-full flex-col items-start gap-0.5 border-b px-3 py-2 text-left last:border-b-0 hover:bg-muted/50" onClick={() => setVariant(item)}>
                    <span className="text-sm font-medium">{item.productTitle} — {item.title}</span>
                    <span className="text-xs text-muted-foreground">{[item.optionValues, item.sku].filter(Boolean).join(" · ")}</span>
                  </button>
                )) : null}
              </div>
            ) : <p className="text-xs text-muted-foreground">Enter a product name, variant name, or SKU to search.</p>}
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="currencyCode">Currency</Label>
              <Select name="currencyCode" value={currencyCode} onValueChange={setSelectedCurrencyCode}>
                <SelectTrigger id="currencyCode" variant="card"><SelectValue placeholder="Select currency" /></SelectTrigger>
                <SelectContent>{currencies.map((currency) => <SelectItem key={currency.code} value={currency.code}>{currency.code.toUpperCase()} — {currency.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="amount">Price</Label>
              <Input id="amount" name="amount" variant="card" type="number" min="0" step={selectedCurrency ? 10 ** -selectedCurrency.decimalDigits : 0.01} required placeholder={selectedCurrency?.decimalDigits ? `0.${"0".repeat(selectedCurrency.decimalDigits)}` : "0"} />
            </div>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="minQuantity">Minimum quantity</Label>
              <Input id="minQuantity" name="minQuantity" variant="card" type="number" min="1" step="1" placeholder="Any quantity" />
              <p className="text-xs text-muted-foreground">Leave blank for the regular price. Set a minimum to create a quantity tier.</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="maxQuantity">Maximum quantity</Label>
              <Input id="maxQuantity" name="maxQuantity" variant="card" type="number" min="1" step="1" placeholder="No maximum" />
              <p className="text-xs text-muted-foreground">Optional. A maximum requires a minimum quantity.</p>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">The amount is stored in the currency’s minor unit. Sale prices show the original price on the storefront; override prices replace it.</p>
        </div>
      </RouteFormModal>
    </form>
  );
}
