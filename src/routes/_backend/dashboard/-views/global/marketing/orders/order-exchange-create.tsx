import { DialogFooterActions } from "@/components/dialog/dialog-footer-actions";
import { findCurrency } from "@/lib/currency/catalog";
import {
  RouteFormModal,
  useCloseOnEscape,
  useRouteModalClose,
  type RouteFormState,
} from "@/components/dialog/route-form-modal";
import { RouteSurfaceMessage } from "@/components/dialog/route-surface-message";
import { RouteSurfacePending } from "@/components/dialog/route-surface-pending";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { OrderExchangeableItemDTO } from "@/lib/order/dto/order.dto";
import {
  normalizeStockLocationListParams,
  stockLocationQueries,
} from "@queries/stock-location.queries";
import { orderQueries } from "@queries/marketing.queries";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "@tanstack/react-router";
import { useActionState, useDeferredValue, useState } from "react";
import { toast } from "sonner";
import { createOrderExchangeAction } from "./order-workflow-actions";

const initialState: RouteFormState = { message: "", success: undefined };

const ExchangeItemSelector = ({
  item,
  currencyCode,
  orderId,
}: {
  item: OrderExchangeableItemDTO;
  currencyCode: string;
  orderId: string;
}) => {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<{
    id: string;
    productTitle: string;
    title: string;
    sku: string | null;
    optionValues: string | null;
  } | null>(null);
  const deferredQuery = useDeferredValue(query.trim());
  const variantsQuery = useQuery({
    ...orderQueries.exchangeVariants(orderId, deferredQuery),
    enabled: deferredQuery.length > 0,
  });

  return (
    <div className="grid gap-3 rounded-md border p-4 sm:grid-cols-2">
      <input type="hidden" name="itemId" value={item.id} />
      {selected ? (
        <input type="hidden" name={`variant:${item.id}`} value={selected.id} />
      ) : null}
      <div className="min-w-0 space-y-1">
        <p className="truncate text-sm font-medium">{item.title}</p>
        <p className="text-xs text-muted-foreground">
          {item.sku || "No SKU"} · {item.returnableQuantity} delivered unit(s)
          available ·{" "}
          {new Intl.NumberFormat(undefined, {
            style: "currency",
            currency: currencyCode.toUpperCase(),
          }).format(item.unitPrice / 100)}{" "}
          original unit price
        </p>
      </div>
      <div className="space-y-2">
        <Label htmlFor={`quantity:${item.id}`}>Quantity to exchange</Label>
        <Input
          id={`quantity:${item.id}`}
          name={`quantity:${item.id}`}
          variant="card"
          type="number"
          min="0"
          max={item.returnableQuantity}
          step="1"
          defaultValue="0"
        />
      </div>
      <div className="space-y-2 sm:col-span-2">
        <Label htmlFor={`variant-search:${item.id}`}>Replacement variant</Label>
        {selected ? (
          <div className="rounded-md border bg-muted/30 p-3 text-sm">
            <div className="font-medium">
              {selected.productTitle} — {selected.title}
            </div>
            <div className="text-xs text-muted-foreground">
              {[selected.optionValues, selected.sku]
                .filter(Boolean)
                .join(" · ")}
            </div>
            <button
              type="button"
              className="mt-2 text-xs text-primary underline"
              onClick={() => setSelected(null)}
            >
              Choose another variant
            </button>
          </div>
        ) : (
          <>
            <Input
              id={`variant-search:${item.id}`}
              variant="card"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search by product, variant, option, or SKU"
            />
            {deferredQuery ? (
              <div className="max-h-48 overflow-auto rounded-md border">
                {variantsQuery.isPending ? (
                  <p className="p-3 text-sm text-muted-foreground">
                    Searching…
                  </p>
                ) : null}
                {variantsQuery.data?.success &&
                variantsQuery.data.data.variants.length === 0 ? (
                  <p className="p-3 text-sm text-muted-foreground">
                    No matching variants.
                  </p>
                ) : null}
                {variantsQuery.data?.success
                  ? variantsQuery.data.data.variants.map((variant) => (
                      <button
                        key={variant.id}
                        type="button"
                        className="flex w-full flex-col items-start gap-0.5 border-b px-3 py-2 text-left last:border-b-0 hover:bg-muted/50"
                        onClick={() => setSelected(variant)}
                      >
                        <span className="text-sm font-medium">
                          {variant.productTitle} — {variant.title}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {[
                            variant.optionValues,
                            variant.sku,
                            new Intl.NumberFormat(undefined, {
                              style: "currency",
                              currency: currencyCode.toUpperCase(),
                            }).format(variant.unitPrice / 100),
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                        </span>
                      </button>
                    ))
                  : null}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">
                Enter a product, variant, option, or SKU to find the
                replacement.
              </p>
            )}
          </>
        )}
      </div>
      <div className="space-y-2 sm:col-span-2">
        <Label htmlFor={`note:${item.id}`}>Internal note</Label>
        <Input
          id={`note:${item.id}`}
          name={`note:${item.id}`}
          variant="card"
          maxLength={1_000}
          placeholder="Optional note for the exchange"
        />
      </div>
    </div>
  );
};

const ExchangeShippingCharge = ({
  direction,
  currencyCode,
  title,
}: {
  direction: "returnShipping" | "outboundShipping";
  currencyCode: string;
  title: string;
}) => {
  const currency = findCurrency(currencyCode);
  const methodId = `${direction}-name`;
  const amountId = `${direction}-amount`;
  return (
    <section className="space-y-3 rounded-md border p-4">
      <div>
        <h3 className="text-sm font-medium">{title}</h3>
        <p className="text-xs text-muted-foreground">
          Optional. Leave both fields blank when no shipping charge applies.
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor={methodId}>Shipping method</Label>
          <Input
            id={methodId}
            name={`${direction}Name`}
            variant="card"
            maxLength={200}
            placeholder="e.g. Home delivery"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor={amountId}>
            Shipping fee ({currencyCode.toUpperCase()})
          </Label>
          <Input
            id={amountId}
            name={`${direction}Amount`}
            variant="card"
            type="number"
            min="0"
            step={10 ** -(currency?.decimalDigits ?? 2)}
            placeholder={
              currency?.decimalDigits
                ? `0.${"0".repeat(currency.decimalDigits)}`
                : "0"
            }
          />
        </div>
      </div>
    </section>
  );
};

export default function OrderExchangeCreate() {
  const { id } = useParams({ strict: false }) as { id: string };
  const close = useRouteModalClose();
  const queryClient = useQueryClient();
  useCloseOnEscape(close);
  const orderQuery = useQuery(orderQueries.detail(id));
  const itemsQuery = useQuery(orderQueries.returnableItems(id));
  const locationsQuery = useQuery(
    stockLocationQueries.list(
      normalizeStockLocationListParams({ limit: 100, sortBy: "name" }),
    ),
  );
  const submit = async (
    state: RouteFormState,
    data: FormData,
  ): Promise<RouteFormState> => {
    const response = await createOrderExchangeAction(state, data);
    if (!response.success) {
      toast.error(response.message, { position: "top-center" });
      return response;
    }
    await queryClient.invalidateQueries({ queryKey: orderQueries.all() });
    toast.success(response.message, { position: "top-center" });
    close();
    return response;
  };
  const [state, formAction, pending] = useActionState(submit, initialState);

  if (orderQuery.isPending || itemsQuery.isPending || locationsQuery.isPending)
    return <RouteSurfacePending />;
  const order = orderQuery.data?.success ? orderQuery.data.data : null;
  const items = itemsQuery.data?.success ? itemsQuery.data.data.items : [];
  const locations = locationsQuery.data?.success
    ? locationsQuery.data.data.locations
    : [];
  if (!order || (itemsQuery.data && !itemsQuery.data.success))
    return (
      <RouteSurfaceMessage>
        {itemsQuery.data?.message ??
          orderQuery.data?.message ??
          "Order not found"}
      </RouteSurfaceMessage>
    );
  if (!items.length)
    return (
      <RouteSurfaceMessage>
        This order has no delivered quantities available for an exchange.
      </RouteSurfaceMessage>
    );
  if (!locations.length)
    return (
      <RouteSurfaceMessage>
        Create a stock location before reserving replacement items.
      </RouteSurfaceMessage>
    );

  return (
    <form action={formAction} className="contents">
      <RouteFormModal
        label={`Create exchange for Order #${order.displayId}`}
        header={<h2 className="text-sm font-medium">Create Exchange</h2>}
        footer={
          <DialogFooterActions
            isSheet={false}
            isLoading={pending}
            onCancel={close}
            submitLabel="Confirm exchange"
            loadingLabel="Confirming..."
          />
        }
      >
        <div className="mx-auto flex w-full max-w-4xl flex-col gap-5 p-6">
          <input type="hidden" name="orderId" value={id} />
          <input type="hidden" name="currencyCode" value={order.currencyCode} />
          <div className="space-y-2">
            <Label htmlFor="locationId">
              Return and fulfillment stock location
            </Label>
            <Select name="locationId" required>
              <SelectTrigger id="locationId" variant="card">
                <SelectValue placeholder="Select a stock location" />
              </SelectTrigger>
              <SelectContent>
                {locations.map((location) => (
                  <SelectItem key={location.id} value={location.id}>
                    {location.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-start gap-2 rounded-md border p-3">
            <input
              id="allowBackorder"
              name="allowBackorder"
              type="checkbox"
              className="mt-1 size-4 accent-primary"
            />
            <Label htmlFor="allowBackorder" className="font-normal">
              Allow replacement items to be reserved on backorder.
            </Label>
          </div>
          <div className="flex items-start gap-2 rounded-md border p-3">
            <input
              id="carryOverPromotions"
              name="carryOverPromotions"
              type="checkbox"
              className="mt-1 size-4 accent-primary"
            />
            <Label htmlFor="carryOverPromotions" className="font-normal">
              Carry over eligible promotions to replacement items. Fixed
              promotions must use EACH allocation; percentage promotions may use
              EACH or ACROSS.
            </Label>
          </div>
          <div className="flex items-start gap-2 rounded-md border p-3">
            <input
              id="sendNotification"
              name="sendNotification"
              type="checkbox"
              className="mt-1 size-4 accent-primary"
              disabled={!order.email}
            />
            <Label htmlFor="sendNotification" className="font-normal">
              Send an exchange confirmation to the customer
              {order.email
                ? ` (${order.email})`
                : " (no customer email on this order)"}
              .
            </Label>
          </div>
          <div className="space-y-3">
            <div>
              <h3 className="text-sm font-medium">Inbound items</h3>
              <p className="text-xs text-muted-foreground">
                Choose delivered items and quantities to return, then select
                each replacement variant.
              </p>
            </div>
            {items.map((item) => (
              <ExchangeItemSelector
                key={item.id}
                item={item}
                currencyCode={order.currencyCode}
                orderId={id}
              />
            ))}
          </div>
          <ExchangeShippingCharge
            direction="returnShipping"
            currencyCode={order.currencyCode}
            title="Return shipping"
          />
          <ExchangeShippingCharge
            direction="outboundShipping"
            currencyCode={order.currencyCode}
            title="Outbound shipping"
          />
          <p className="text-xs text-muted-foreground">
            Shipping fees are included in the exchange balance. The exchange
            does not capture, refund, or settle payment. Outbound items can be
            fulfilled from the order page; inbound items can be received as a
            return.
          </p>
          {state.message ? (
            <p role="alert" className="text-sm text-destructive">
              {state.message}
            </p>
          ) : null}
        </div>
      </RouteFormModal>
    </form>
  );
}
