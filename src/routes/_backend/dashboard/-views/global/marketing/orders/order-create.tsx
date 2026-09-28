import { DialogFooterActions } from "@/components/dialog/dialog-footer-actions";
import {
  RouteFormModal,
  useCloseOnEscape,
  useRouteModalClose,
  type RouteFormState,
} from "@/components/dialog/route-form-modal";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  findCurrency,
  formatMoney,
  toMajorUnits,
  toMinorUnits,
} from "@/lib/currency/catalog";
import type { CustomerListItemDTO } from "@/lib/customer/dto/customer.dto";
import type { DraftOrderItemInput } from "@/lib/validations/marketing";
import {
  DraftOrderAddressFields,
  emptyDraftOrderAddress,
  serializeDraftOrderAddress,
  type DraftOrderAddress,
} from "./order-address-fields";
import {
  customerQueries,
  normalizeCustomerListParams,
} from "@queries/customer.queries";
import { currencyQueries } from "@queries/currency.queries";
import { orderQueries } from "@queries/marketing.queries";
import {
  normalizeRegionListParams,
  regionQueries,
} from "@queries/region.queries";
import {
  normalizeSalesChannelListParams,
  salesChannelQueries,
} from "@queries/sales-channel.queries";
import { createOrder } from "@/server/marketing/orders.serverFn";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useActionState, useDeferredValue, useEffect, useState } from "react";
import { toast } from "sonner";

const initialState: RouteFormState = { message: "", success: undefined };

type DraftLineItem =
  | {
      key: string;
      type: "variant";
      variantId: string;
      productTitle: string;
      title: string;
      sku: string | null;
      optionValues: string | null;
      unitPrice: number | null;
      quantity: number;
      customPrice: boolean;
      priceInput: string;
    }
  | {
      key: string;
      type: "custom";
      title: string;
      sku: string;
      quantity: number;
      priceInput: string;
    };

const CustomerPicker = ({
  selected,
  onSelect,
  onClear,
}: {
  selected: CustomerListItemDTO | null;
  onSelect: (customer: CustomerListItemDTO) => void;
  onClear: () => void;
}) => {
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query.trim());
  const customersQuery = useQuery({
    ...customerQueries.list(
      normalizeCustomerListParams({
        q: deferredQuery,
        sortBy: "email",
        sortOrder: "asc",
        page: 1,
        limit: 10,
      }),
    ),
    enabled: deferredQuery.length > 0 && !selected,
  });
  const customers = customersQuery.data?.success
    ? customersQuery.data.data.customers
    : [];

  if (selected) {
    return (
      <div className="rounded-md border p-3">
        <p className="text-sm font-medium">
          {[selected.firstName, selected.lastName].filter(Boolean).join(" ") ||
            selected.email ||
            "Customer"}
        </p>
        <p className="text-xs text-muted-foreground">
          {selected.email || "No customer email"}
        </p>
        <button
          type="button"
          className="mt-2 text-xs text-primary underline"
          onClick={onClear}
        >
          Change customer
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <Label htmlFor="customer-search">Customer (optional)</Label>
      <Input
        id="customer-search"
        variant="card"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Search by customer name or email"
        autoComplete="off"
      />
      {deferredQuery ? (
        <div className="max-h-48 overflow-auto rounded-md border">
          {customersQuery.isError ? (
            <p role="alert" className="p-3 text-sm text-destructive">
              Customer search failed. Try again.
            </p>
          ) : null}
          {customersQuery.isPending ? (
            <p className="p-3 text-sm text-muted-foreground">Searching…</p>
          ) : null}
          {!customersQuery.isPending &&
          !customersQuery.isError &&
          customers.length === 0 ? (
            <p className="p-3 text-sm text-muted-foreground">
              No matching customers.
            </p>
          ) : null}
          {customers.map((customer) => (
            <button
              key={customer.id}
              type="button"
              className="flex w-full flex-col items-start gap-0.5 border-b px-3 py-2 text-left last:border-b-0 hover:bg-muted/50"
              onClick={() => {
                onSelect(customer);
                setQuery("");
              }}
            >
              <span className="text-sm font-medium">
                {[customer.firstName, customer.lastName]
                  .filter(Boolean)
                  .join(" ") ||
                  customer.email ||
                  "Customer"}
              </span>
              <span className="text-xs text-muted-foreground">
                {customer.email || "No email"}
              </span>
            </button>
          ))}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">
          Select a customer to use their customer group pricing and email.
        </p>
      )}
    </div>
  );
};

const OrderCreate = () => {
  const close = useRouteModalClose();
  useCloseOnEscape(close);
  const queryClient = useQueryClient();
  const [state, formAction, pending] = useActionState(
    async (
      _state: RouteFormState,
      formData: FormData,
    ): Promise<RouteFormState> => {
      let items: DraftOrderItemInput[];
      let shippingAddress: DraftOrderAddress | null;
      let billingAddress: DraftOrderAddress | null;
      try {
        const parsedItems: unknown = JSON.parse(
          String(formData.get("items") ?? "[]"),
        );
        if (!Array.isArray(parsedItems))
          throw new Error("Items must be an array");
        items = parsedItems as typeof items;
        const parsedShipping: unknown = JSON.parse(
          String(formData.get("shippingAddress") ?? "null"),
        );
        const parsedBilling: unknown = JSON.parse(
          String(formData.get("billingAddress") ?? "null"),
        );
        shippingAddress = parsedShipping as DraftOrderAddress | null;
        billingAddress = parsedBilling as DraftOrderAddress | null;
      } catch {
        const invalid = {
          success: false as const,
          message: "Review the draft order items and try again.",
          data: null,
          error: "INVALID_ITEMS",
        };
        toast.error(invalid.message, { position: "top-center" });
        return invalid;
      }
      const customerId = String(formData.get("customerId") ?? "");
      const regionId = String(formData.get("regionId") ?? "");
      const salesChannelId = String(formData.get("salesChannelId") ?? "");
      const result = await createOrder({
        data: {
          email: String(formData.get("email") ?? ""),
          ...(customerId ? { customerId } : {}),
          ...(regionId ? { regionId } : {}),
          ...(salesChannelId ? { salesChannelId } : {}),
          shippingAddress: shippingAddress
            ? serializeDraftOrderAddress(shippingAddress)
            : null,
          billingAddress: billingAddress
            ? serializeDraftOrderAddress(billingAddress)
            : null,
          currencyCode: String(formData.get("currencyCode") ?? "twd"),
          noNotification: formData.get("noNotification") === "on",
          items,
        },
      });
      if (!result.success) {
        toast.error(result.message, { position: "top-center" });
        return result;
      }
      await queryClient.invalidateQueries({ queryKey: orderQueries.all() });
      toast.success(result.message, { position: "top-center" });
      close();
      return result;
    },
    initialState,
  );

  const settingsQuery = useQuery(currencyQueries.store());
  const currenciesQuery = useQuery(currencyQueries.available());
  const regionsQuery = useQuery(
    regionQueries.list(
      normalizeRegionListParams({
        sortBy: "name",
        sortOrder: "asc",
        page: 1,
        limit: 100,
      }),
    ),
  );
  const salesChannelsQuery = useQuery(
    salesChannelQueries.list(
      normalizeSalesChannelListParams({
        sortBy: "name",
        sortOrder: "asc",
        page: 1,
        limit: 100,
      }),
    ),
  );
  const [currencyCode, setCurrencyCode] = useState("twd");
  const [regionId, setRegionId] = useState("");
  const [salesChannelId, setSalesChannelId] = useState("");
  const [selectedCustomer, setSelectedCustomer] =
    useState<CustomerListItemDTO | null>(null);
  const [email, setEmail] = useState("");
  const [shippingAddress, setShippingAddress] = useState<DraftOrderAddress>(
    emptyDraftOrderAddress,
  );
  const [billingAddress, setBillingAddress] = useState<DraftOrderAddress>(
    emptyDraftOrderAddress,
  );
  const [billingSameAsShipping, setBillingSameAsShipping] = useState(true);
  const [variantQuery, setVariantQuery] = useState("");
  const deferredVariantQuery = useDeferredValue(variantQuery.trim());
  const [lineItems, setLineItems] = useState<DraftLineItem[]>([]);

  const storeSettings = settingsQuery.data?.success
    ? settingsQuery.data.data
    : null;
  const currencyChoices = currenciesQuery.data?.success
    ? currenciesQuery.data.data
    : [];
  const regions = regionsQuery.data?.success
    ? regionsQuery.data.data.regions
    : [];
  const salesChannels = salesChannelsQuery.data?.success
    ? salesChannelsQuery.data.data.salesChannels.filter(
        (channel) => !channel.isDisabled,
      )
    : [];
  const contextLoadError =
    settingsQuery.isError ||
    currenciesQuery.isError ||
    regionsQuery.isError ||
    salesChannelsQuery.isError;
  const currency = currencyChoices.find(
    (choice) => choice.code === currencyCode,
  ) ??
    findCurrency(currencyCode) ?? { code: currencyCode, decimalDigits: 2 };
  const selectedRegion = regions.find((region) => region.id === regionId);
  const pricingContextChanged = () => {
    setLineItems((current) => current.filter((item) => item.type === "custom"));
    setVariantQuery("");
  };

  useEffect(() => {
    if (!storeSettings) return;
    if (!regionId && !selectedCustomer) {
      const defaultCurrency = storeSettings.supportedCurrencies.find(
        (item) => item.isDefault,
      )?.code;
      if (defaultCurrency) setCurrencyCode(defaultCurrency);
    }
    if (!salesChannelId) setSalesChannelId(storeSettings.defaultSalesChannelId);
  }, [regionId, salesChannelId, selectedCustomer, storeSettings]);

  const variantsQuery = useQuery({
    ...orderQueries.draftVariants({
      query: deferredVariantQuery,
      currencyCode,
      quantity: 1,
      ...(selectedCustomer ? { customerId: selectedCustomer.id } : {}),
      ...(regionId ? { regionId } : {}),
      ...(salesChannelId ? { salesChannelId } : {}),
      limit: 10,
    }),
    enabled: deferredVariantQuery.length > 0 && currencyCode.length === 3,
  });
  const variants = variantsQuery.data?.success
    ? variantsQuery.data.data.variants
    : [];

  const serializedItems = lineItems.map((item) => {
    const quantity = Math.max(1, Math.floor(item.quantity) || 1);
    if (item.type === "custom") {
      return {
        type: "custom",
        title: item.title,
        ...(item.sku.trim() ? { sku: item.sku.trim() } : {}),
        quantity,
        unitPrice: toMinorUnits(item.priceInput || "0", currency),
      };
    }
    return {
      type: "variant",
      variantId: item.variantId,
      quantity,
      customPrice: item.customPrice,
      ...(item.customPrice
        ? { unitPrice: toMinorUnits(item.priceInput || "0", currency) }
        : {}),
    };
  });
  const serializedShippingAddress = serializeDraftOrderAddress(shippingAddress);
  const serializedBillingAddress = billingSameAsShipping
    ? serializedShippingAddress
    : serializeDraftOrderAddress(billingAddress);

  const addVariant = (variant: (typeof variants)[number]) => {
    setLineItems((current) => {
      const existing = current.find(
        (item) => item.type === "variant" && item.variantId === variant.id,
      );
      if (existing?.type === "variant") {
        return current.map((item) =>
          item.key === existing.key
            ? { ...item, quantity: item.quantity + 1 }
            : item,
        );
      }
      return [
        ...current,
        {
          key: `variant:${variant.id}`,
          type: "variant" as const,
          variantId: variant.id,
          productTitle: variant.productTitle,
          title: variant.title,
          sku: variant.sku,
          optionValues: variant.optionValues,
          unitPrice: variant.unitPrice,
          quantity: 1,
          customPrice: variant.unitPrice === null,
          priceInput:
            variant.unitPrice === null
              ? "0"
              : String(toMajorUnits(variant.unitPrice, currency)),
        },
      ];
    });
    setVariantQuery("");
  };

  const updateLine = (key: string, patch: Partial<DraftLineItem>) =>
    setLineItems((current) =>
      current.map((item) =>
        item.key === key ? ({ ...item, ...patch } as DraftLineItem) : item,
      ),
    );

  const addCustomItem = () => {
    setLineItems((current) => [
      ...current,
      {
        key: `custom:${crypto.randomUUID()}`,
        type: "custom",
        title: "",
        sku: "",
        quantity: 1,
        priceInput: "0",
      },
    ]);
  };

  return (
    <form action={formAction} className="contents">
      <RouteFormModal
        label="Create Draft Order"
        header={<h2 className="text-sm font-medium">Create Draft Order</h2>}
        footer={
          <DialogFooterActions
            isSheet={false}
            isLoading={pending}
            onCancel={close}
            submitLabel="Create draft"
            loadingLabel="Creating..."
          />
        }
      >
        <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 p-6">
          <div className="space-y-1">
            <h1 className="text-md font-medium">Create Draft Order</h1>
            <p className="text-sm text-muted-foreground">
              Select the market and customer first, then add catalog variants or
              custom items. Variant prices are resolved again when the draft is
              saved.
            </p>
          </div>

          <section className="grid gap-4 rounded-md border p-4 sm:grid-cols-2">
            {contextLoadError ? (
              <p
                role="alert"
                className="text-sm text-destructive sm:col-span-2"
              >
                Some store settings could not be loaded. Refresh the form if you
                need to select a region, currency, or sales channel.
              </p>
            ) : null}
            <div className="space-y-2">
              <Label htmlFor="regionId">Region</Label>
              <Select
                value={regionId || "none"}
                onValueChange={(value) => {
                  pricingContextChanged();
                  const nextRegionId = value === "none" ? "" : value;
                  setRegionId(nextRegionId);
                  const nextRegion = regions.find(
                    (region) => region.id === nextRegionId,
                  );
                  if (nextRegion) setCurrencyCode(nextRegion.currencyCode);
                }}
              >
                <SelectTrigger id="regionId" variant="card">
                  <SelectValue placeholder="No region" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No region</SelectItem>
                  {regions.map((region) => (
                    <SelectItem key={region.id} value={region.id}>
                      {region.name} · {region.currencyCode.toUpperCase()}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="salesChannelId">Sales channel</Label>
              <Select
                value={salesChannelId || "none"}
                onValueChange={(value) => {
                  pricingContextChanged();
                  setSalesChannelId(value === "none" ? "" : value);
                }}
              >
                <SelectTrigger id="salesChannelId" variant="card">
                  <SelectValue placeholder="Select a sales channel" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No sales channel</SelectItem>
                  {salesChannels.map((channel) => (
                    <SelectItem key={channel.id} value={channel.id}>
                      {channel.name}
                      {channel.isDefault ? " · Default" : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="currencyCode">Currency</Label>
              <Select
                value={currencyCode}
                onValueChange={(value) => {
                  pricingContextChanged();
                  setCurrencyCode(value);
                }}
                disabled={Boolean(selectedRegion)}
                required
              >
                <SelectTrigger id="currencyCode" variant="card">
                  <SelectValue placeholder="Select a currency" />
                </SelectTrigger>
                <SelectContent>
                  {currencyChoices.map((choice) => (
                    <SelectItem key={choice.code} value={choice.code}>
                      {choice.code.toUpperCase()} · {choice.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {selectedRegion ? (
                <p className="text-xs text-muted-foreground">
                  Currency follows the selected region.
                </p>
              ) : null}
            </div>
            <div className="space-y-2">
              <Label htmlFor="email">Customer email</Label>
              <Input
                id="email"
                name="email"
                type="email"
                variant="card"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="customer@example.com"
              />
            </div>
            <div className="sm:col-span-2">
              <CustomerPicker
                selected={selectedCustomer}
                onSelect={(customer) => {
                  pricingContextChanged();
                  setSelectedCustomer(customer);
                  setEmail(customer.email ?? "");
                }}
                onClear={() => {
                  pricingContextChanged();
                  setSelectedCustomer(null);
                }}
              />
            </div>
            <label className="flex items-start gap-2 text-sm sm:col-span-2">
              <input
                name="noNotification"
                type="checkbox"
                className="mt-1 size-4 accent-primary"
              />
              <span>
                Disable customer notifications
                <span className="mt-0.5 block text-xs text-muted-foreground">
                  No email is sent while this draft is being prepared.
                </span>
              </span>
            </label>
          </section>

          <section className="space-y-4 rounded-md border p-4">
            <div>
              <h2 className="text-sm font-medium">Shipping address</h2>
              <p className="text-xs text-muted-foreground">
                Save the address with this order. You can choose shipping
                options after creating the draft.
              </p>
            </div>
            <DraftOrderAddressFields
              idPrefix="shipping-address"
              address={shippingAddress}
              onChange={setShippingAddress}
            />
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                checked={billingSameAsShipping}
                onChange={(event) =>
                  setBillingSameAsShipping(event.target.checked)
                }
                className="mt-1 size-4 accent-primary"
              />
              <span>Billing address is the same as shipping</span>
            </label>
            {!billingSameAsShipping ? (
              <div className="space-y-3 border-t pt-4">
                <h3 className="text-sm font-medium">Billing address</h3>
                <DraftOrderAddressFields
                  idPrefix="billing-address"
                  address={billingAddress}
                  onChange={setBillingAddress}
                />
              </div>
            ) : null}
          </section>

          <section className="space-y-3">
            <div>
              <h2 className="text-sm font-medium">Items</h2>
              <p className="text-xs text-muted-foreground">
                Search products by title, variant, option, or SKU. Prices use
                the selected currency, region, channel, customer group, and
                quantity rules.
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="variant-search">Add a product variant</Label>
              <Input
                id="variant-search"
                variant="card"
                value={variantQuery}
                onChange={(event) => setVariantQuery(event.target.value)}
                placeholder="Search product, variant, option, or SKU"
                autoComplete="off"
              />
              {deferredVariantQuery ? (
                <div className="max-h-56 overflow-auto rounded-md border">
                  {variantsQuery.isError ? (
                    <p role="alert" className="p-3 text-sm text-destructive">
                      Product search failed. Try again.
                    </p>
                  ) : null}
                  {variantsQuery.isPending ? (
                    <p className="p-3 text-sm text-muted-foreground">
                      Searching…
                    </p>
                  ) : null}
                  {!variantsQuery.isPending &&
                  !variantsQuery.isError &&
                  variants.length === 0 ? (
                    <p className="p-3 text-sm text-muted-foreground">
                      No matching variants.
                    </p>
                  ) : null}
                  {variants.map((variant) => (
                    <button
                      key={variant.id}
                      type="button"
                      className="flex w-full flex-col items-start gap-0.5 border-b px-3 py-2 text-left last:border-b-0 hover:bg-muted/50"
                      onClick={() => addVariant(variant)}
                    >
                      <span className="text-sm font-medium">
                        {variant.productTitle} — {variant.title}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {[
                          variant.optionValues,
                          variant.sku,
                          variant.unitPrice === null
                            ? "No catalog price"
                            : formatMoney(variant.unitPrice, currency),
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                    </button>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Type at least one character to search catalog variants.
                </p>
              )}
            </div>

            {lineItems.length ? (
              <div className="space-y-3">
                {lineItems.map((item) => (
                  <article
                    key={item.key}
                    className="space-y-3 rounded-md border p-4"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">
                          {item.type === "variant"
                            ? `${item.productTitle} — ${item.title}`
                            : item.title || "Custom item"}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {item.type === "variant"
                            ? [item.optionValues, item.sku]
                                .filter(Boolean)
                                .join(" · ") || "No SKU"
                            : item.sku || "Custom item"}
                        </p>
                      </div>
                      <button
                        type="button"
                        className="shrink-0 text-xs text-destructive underline"
                        onClick={() =>
                          setLineItems((current) =>
                            current.filter(
                              (candidate) => candidate.key !== item.key,
                            ),
                          )
                        }
                      >
                        Remove
                      </button>
                    </div>
                    {item.type === "custom" ? (
                      <div className="grid gap-3 sm:grid-cols-2">
                        <div className="space-y-2">
                          <Label htmlFor={`${item.key}:title`}>
                            Item title
                          </Label>
                          <Input
                            id={`${item.key}:title`}
                            variant="card"
                            value={item.title}
                            maxLength={200}
                            onChange={(event) =>
                              updateLine(item.key, {
                                title: event.target.value,
                              })
                            }
                          />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor={`${item.key}:sku`}>SKU</Label>
                          <Input
                            id={`${item.key}:sku`}
                            variant="card"
                            value={item.sku}
                            maxLength={100}
                            onChange={(event) =>
                              updateLine(item.key, { sku: event.target.value })
                            }
                          />
                        </div>
                      </div>
                    ) : null}
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="space-y-2">
                        <Label htmlFor={`${item.key}:quantity`}>Quantity</Label>
                        <Input
                          id={`${item.key}:quantity`}
                          variant="card"
                          type="number"
                          min="1"
                          max="100000"
                          step="1"
                          value={item.quantity}
                          onChange={(event) =>
                            updateLine(item.key, {
                              quantity: Number(event.target.value),
                            })
                          }
                        />
                      </div>
                      {item.type === "custom" || item.customPrice ? (
                        <div className="space-y-2">
                          <Label htmlFor={`${item.key}:price`}>
                            Unit price ({currencyCode.toUpperCase()})
                          </Label>
                          <Input
                            id={`${item.key}:price`}
                            variant="card"
                            type="number"
                            min="0"
                            step={10 ** -currency.decimalDigits}
                            value={item.priceInput}
                            onChange={(event) =>
                              updateLine(item.key, {
                                priceInput: event.target.value,
                              })
                            }
                          />
                        </div>
                      ) : (
                        <div className="flex flex-col justify-center gap-1">
                          <p className="text-sm">
                            {item.unitPrice === null
                              ? "No price in this context"
                              : formatMoney(item.unitPrice, currency)}
                          </p>
                          <label className="flex items-center gap-2 text-xs text-muted-foreground">
                            <input
                              type="checkbox"
                              checked={item.customPrice}
                              onChange={(event) =>
                                updateLine(item.key, {
                                  customPrice: event.target.checked,
                                  priceInput:
                                    item.priceInput ||
                                    String(
                                      toMajorUnits(
                                        item.unitPrice ?? 0,
                                        currency,
                                      ),
                                    ),
                                })
                              }
                            />
                            Set a custom unit price
                          </label>
                        </div>
                      )}
                    </div>
                    {item.type === "variant" && item.customPrice ? (
                      <label className="flex items-center gap-2 text-xs text-muted-foreground">
                        <input
                          type="checkbox"
                          checked={item.customPrice}
                          onChange={(event) =>
                            updateLine(item.key, {
                              customPrice: event.target.checked,
                            })
                          }
                        />
                        Use the current catalog price instead
                      </label>
                    ) : null}
                  </article>
                ))}
              </div>
            ) : (
              <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
                No items added yet.
              </p>
            )}
            <button
              type="button"
              className="text-sm text-primary underline"
              onClick={addCustomItem}
            >
              Add custom item
            </button>
          </section>

          <input
            type="hidden"
            name="items"
            value={JSON.stringify(serializedItems)}
            readOnly
          />
          <input
            type="hidden"
            name="customerId"
            value={selectedCustomer?.id ?? ""}
            readOnly
          />
          <input type="hidden" name="regionId" value={regionId} readOnly />
          <input
            type="hidden"
            name="salesChannelId"
            value={salesChannelId}
            readOnly
          />
          <input
            type="hidden"
            name="shippingAddress"
            value={JSON.stringify(serializedShippingAddress)}
            readOnly
          />
          <input
            type="hidden"
            name="billingAddress"
            value={JSON.stringify(serializedBillingAddress)}
            readOnly
          />
          <input
            type="hidden"
            name="currencyCode"
            value={currencyCode}
            readOnly
          />
          {state.message ? (
            <p role="alert" className="text-sm text-destructive">
              {state.message}
            </p>
          ) : null}
        </div>
      </RouteFormModal>
    </form>
  );
};

export default OrderCreate;
