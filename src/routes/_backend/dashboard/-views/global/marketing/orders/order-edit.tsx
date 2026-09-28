import { DialogFooterActions } from "@/components/dialog/dialog-footer-actions";
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
import {
  findCurrency,
  formatMoney,
  toMajorUnits,
  toMinorUnits,
} from "@/lib/currency/catalog";
import type { OrderDetailDTO, OrderItemDTO } from "@/lib/order/dto/order.dto";
import { orderQueries } from "@queries/marketing.queries";
import {
  DraftOrderAddressFields,
  draftOrderAddressFromDTO,
  serializeDraftOrderAddress,
  type DraftOrderAddress,
} from "./order-address-fields";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "@tanstack/react-router";
import { useActionState, useDeferredValue, useEffect, useState } from "react";
import { toast } from "sonner";

const initialState: RouteFormState = { message: "", success: undefined };

const mutateDraftOrderEdit = async (
  orderId: string,
  path: string,
  method: "POST" | "PATCH" | "DELETE",
  body?: unknown,
) => {
  const response = await fetch(
    `/api/admin/draft-orders/${encodeURIComponent(orderId)}/edit${path}`,
    {
      method,
      ...(body !== undefined
        ? {
            headers: { "content-type": "application/json" },
            body: JSON.stringify(body),
          }
        : {}),
    },
  );
  const result: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      result &&
      typeof result === "object" &&
      "message" in result &&
      typeof result.message === "string"
        ? result.message
        : "The draft order edit could not be saved";
    throw new Error(message);
  }
  return result;
};

type OrderEditRequestBody = {
  email?: string;
  no_notification?: boolean;
  items?: Array<
    | { item_id: string; action: "ITEM_UPDATE"; quantity: number }
    | { item_id: string; action: "ITEM_REMOVE" }
  >;
};

type OrderEditItemChange = NonNullable<OrderEditRequestBody["items"]>[number];

const requestCustomerOrderEdit = async (
  orderId: string,
  body: OrderEditRequestBody,
) => {
  const response = await fetch(
    `/api/admin/orders/${encodeURIComponent(orderId)}/edit`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    },
  );
  const result: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      result &&
      typeof result === "object" &&
      "message" in result &&
      typeof result.message === "string"
        ? result.message
        : "The order edit request could not be saved";
    throw new Error(message);
  }
  return result;
};

const buildOrderItemChanges = (
  items: OrderItemDTO[] | null,
  removedItems: string[],
  quantities: Record<string, string>,
) => {
  const changes: OrderEditItemChange[] = [];
  let invalidQuantityTitle: string | null = null;
  for (const item of items ?? []) {
    if (removedItems.includes(item.id)) {
      changes.push({ item_id: item.id, action: "ITEM_REMOVE" });
      continue;
    }
    const quantity = Number(quantities[item.id] ?? item.quantity);
    if (
      !Number.isSafeInteger(quantity) ||
      quantity < 1 ||
      quantity > item.quantity
    ) {
      invalidQuantityTitle = item.title;
      continue;
    }
    if (quantity < item.quantity)
      changes.push({ item_id: item.id, action: "ITEM_UPDATE", quantity });
  }
  return { changes, invalidQuantityTitle };
};

type DraftEditSubmissionLine =
  | {
      key: string;
      type: "variant";
      variantId: string;
      quantity: number;
      customPrice: boolean;
      unitPrice?: number;
    }
  | {
      key: string;
      type: "custom";
      title: string;
      sku?: string;
      quantity: number;
      unitPrice: number;
    };

type DraftEditLine =
  | {
      key: string;
      type: "variant";
      variantId: string;
      title: string;
      sku: string;
      quantity: number;
      unitPrice: number;
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

const DraftOrderEdit = ({
  order,
  orderId,
}: {
  order: OrderDetailDTO;
  orderId: string;
}) => {
  const close = useRouteModalClose();
  const queryClient = useQueryClient();
  const itemsQuery = useQuery({
    ...orderQueries.items({ orderId, page: 1, limit: 100 }),
    enabled: order.isDraftOrder,
  });
  const shippingOptionsQuery = useQuery(
    orderQueries.draftShippingOptions({
      id: orderId,
      expectedVersion: order.version,
    }),
  );
  const itemRows =
    !itemsQuery.isPlaceholderData && itemsQuery.data?.success
      ? itemsQuery.data.data.items
      : null;
  const currency = findCurrency(order.currencyCode) ?? {
    code: order.currencyCode,
    decimalDigits: 2,
  };
  const [lineItems, setLineItems] = useState<DraftEditLine[]>([]);
  const [variantQuery, setVariantQuery] = useState("");
  const deferredVariantQuery = useDeferredValue(variantQuery.trim());
  const [shippingAddress, setShippingAddress] = useState<DraftOrderAddress>(
    () => draftOrderAddressFromDTO(order.shippingAddress),
  );
  const [billingAddress, setBillingAddress] = useState<DraftOrderAddress>(() =>
    draftOrderAddressFromDTO(order.billingAddress),
  );
  const addressesMatch = Boolean(
    order.shippingAddress &&
    order.billingAddress &&
    Object.keys(order.shippingAddress).every(
      (key) =>
        order.shippingAddress?.[key as keyof typeof order.shippingAddress] ===
        order.billingAddress?.[key as keyof typeof order.billingAddress],
    ),
  );
  const [billingSameAsShipping, setBillingSameAsShipping] =
    useState(addressesMatch);
  const [shippingOptionIdsState, setShippingOptionIdsState] = useState<
    string[] | undefined
  >();
  const [shippingCustomAmountInputsState, setShippingCustomAmountInputsState] =
    useState<Record<string, string>>();
  const [promotionCodesState, setPromotionCodesState] = useState<string[]>();
  const [promotionCodeInput, setPromotionCodeInput] = useState("");
  const shippingQuote = shippingOptionsQuery.data?.success
    ? shippingOptionsQuery.data.data
    : null;
  const shippingOptionIds =
    shippingOptionIdsState ?? shippingQuote?.selectedShippingOptionIds ?? [];
  const savedCustomAmountInputs = Object.fromEntries(
    (shippingQuote?.selectedShippingMethods ?? [])
      .filter((method) => method.shippingOptionId && method.isCustomAmount)
      .map((method) => [
        method.shippingOptionId!,
        String(toMajorUnits(method.amount, currency)),
      ]),
  );
  const shippingCustomAmountInputs =
    shippingCustomAmountInputsState ?? savedCustomAmountInputs;
  const promotionCodes =
    promotionCodesState ?? shippingQuote?.appliedPromotionCodes ?? [];

  useEffect(() => {
    if (!itemRows) return;
    const draftCurrency = findCurrency(order.currencyCode) ?? {
      code: order.currencyCode,
      decimalDigits: 2,
    };
    setLineItems(
      itemRows.map((item: OrderItemDTO) => {
        if (!item.variantId) {
          return {
            key: item.id,
            type: "custom" as const,
            title: item.title,
            sku: item.sku ?? "",
            quantity: item.quantity,
            priceInput: String(toMajorUnits(item.unitPrice, draftCurrency)),
          };
        }
        return {
          key: item.id,
          type: "variant" as const,
          variantId: item.variantId,
          title: item.title,
          sku: item.sku ?? "",
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          customPrice: item.isCustomPrice,
          priceInput: String(toMajorUnits(item.unitPrice, draftCurrency)),
        };
      }),
    );
  }, [itemRows, order.currencyCode]);

  const variantsQuery = useQuery({
    ...orderQueries.draftVariants({
      query: deferredVariantQuery,
      currencyCode: order.currencyCode,
      quantity: 1,
      ...(order.customerId ? { customerId: order.customerId } : {}),
      ...(order.regionId ? { regionId: order.regionId } : {}),
      ...(order.salesChannelId ? { salesChannelId: order.salesChannelId } : {}),
      limit: 10,
    }),
    enabled: deferredVariantQuery.length > 0,
  });
  const variants = variantsQuery.data?.success
    ? variantsQuery.data.data.variants
    : [];

  const [state, formAction, pending] = useActionState(
    async (
      _state: RouteFormState,
      formData: FormData,
    ): Promise<RouteFormState> => {
      let submittedItems: DraftEditSubmissionLine[];
      let nextShippingAddress: DraftOrderAddress | null;
      let nextBillingAddress: DraftOrderAddress | null;
      let nextShippingOptionIds: string[];
      let nextShippingCustomAmounts: Array<{
        shippingOptionId: string;
        amount: number;
      }>;
      let nextPromotionCodes: string[];
      try {
        const parsedItems: unknown = JSON.parse(
          String(formData.get("items") ?? "[]"),
        );
        if (
          !Array.isArray(parsedItems) ||
          !parsedItems.every(
            (item) =>
              item &&
              typeof item === "object" &&
              "key" in item &&
              typeof item.key === "string",
          )
        )
          throw new Error("Items must be an array");
        submittedItems = parsedItems as DraftEditSubmissionLine[];
        nextShippingAddress = JSON.parse(
          String(formData.get("shippingAddress") ?? "null"),
        ) as DraftOrderAddress | null;
        nextBillingAddress = JSON.parse(
          String(formData.get("billingAddress") ?? "null"),
        ) as DraftOrderAddress | null;
        const parsedShippingOptionIds: unknown = JSON.parse(
          String(formData.get("shippingOptionIds") ?? "[]"),
        );
        if (
          !Array.isArray(parsedShippingOptionIds) ||
          !parsedShippingOptionIds.every((id) => typeof id === "string")
        )
          throw new Error("Shipping options must be an array");
        nextShippingOptionIds = parsedShippingOptionIds;
        const parsedShippingCustomAmounts: unknown = JSON.parse(
          String(formData.get("shippingCustomAmounts") ?? "[]"),
        );
        if (!Array.isArray(parsedShippingCustomAmounts))
          throw new Error("Shipping custom amounts must be an array");
        nextShippingCustomAmounts = parsedShippingCustomAmounts as Array<{
          shippingOptionId: string;
          amount: number;
        }>;
        const parsedPromotionCodes: unknown = JSON.parse(
          String(formData.get("promotionCodes") ?? "[]"),
        );
        if (
          !Array.isArray(parsedPromotionCodes) ||
          !parsedPromotionCodes.every((code) => typeof code === "string")
        )
          throw new Error("Promotion codes must be an array");
        nextPromotionCodes = parsedPromotionCodes;
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
      let editStarted = false;
      try {
        if (!itemRows || !shippingQuote)
          throw new Error("Reload the draft order before saving changes");
        if (shippingQuote.hasCustomShippingMethod)
          throw new Error(
            "Replace the custom shipping charge with a configured shipping option before saving",
          );
        await mutateDraftOrderEdit(orderId, "", "POST");
        editStarted = true;

        const existingById = new Map(itemRows.map((item) => [item.id, item]));
        const desiredById = new Map(
          submittedItems
            .filter((item) => existingById.has(item.key))
            .map((item) => [item.key, item]),
        );
        const addItem = (item: DraftEditSubmissionLine) =>
          mutateDraftOrderEdit(orderId, "/items", "POST", {
            items: [
              item.type === "variant"
                ? {
                    variant_id: item.variantId,
                    quantity: item.quantity,
                    ...(item.customPrice && item.unitPrice !== undefined
                      ? { unit_price: item.unitPrice }
                      : {}),
                  }
                : {
                    title: item.title,
                    ...(item.sku ? { sku: item.sku } : {}),
                    quantity: item.quantity,
                    unit_price: item.unitPrice,
                  },
            ],
          });
        const removeItem = (itemId: string) =>
          mutateDraftOrderEdit(
            orderId,
            `/items/item/${encodeURIComponent(itemId)}`,
            "DELETE",
          );

        for (const existing of itemRows) {
          const desired = desiredById.get(existing.id);
          if (!desired) {
            await removeItem(existing.id);
            continue;
          }
          if (
            desired.type === "variant" &&
            existing.variantId === desired.variantId
          ) {
            const priceChanged =
              desired.customPrice !== existing.isCustomPrice ||
              (desired.customPrice && desired.unitPrice !== existing.unitPrice);
            if (priceChanged) {
              await removeItem(existing.id);
              await addItem(desired);
            } else if (desired.quantity !== existing.quantity) {
              await mutateDraftOrderEdit(
                orderId,
                `/items/item/${encodeURIComponent(existing.id)}`,
                "POST",
                { quantity: desired.quantity },
              );
            }
            continue;
          }
          if (
            desired.type === "custom" &&
            existing.variantId === null &&
            existing.title === desired.title &&
            (existing.sku ?? "") === (desired.sku ?? "") &&
            existing.unitPrice === desired.unitPrice &&
            existing.quantity === desired.quantity
          )
            continue;
          await removeItem(existing.id);
          await addItem(desired);
        }
        for (const item of submittedItems)
          if (!existingById.has(item.key)) await addItem(item);

        const savedCodes = shippingQuote.appliedPromotionCodes;
        const nextCodes = new Set(
          nextPromotionCodes.map((code) => code.toUpperCase()),
        );
        const savedCodeSet = new Set(
          savedCodes.map((code) => code.toUpperCase()),
        );
        const removedCodes = savedCodes.filter(
          (code) => !nextCodes.has(code.toUpperCase()),
        );
        const addedCodes = nextPromotionCodes.filter(
          (code) => !savedCodeSet.has(code.toUpperCase()),
        );
        if (removedCodes.length)
          await mutateDraftOrderEdit(orderId, "/promotions", "DELETE", {
            promo_codes: removedCodes,
          });
        if (addedCodes.length)
          await mutateDraftOrderEdit(orderId, "/promotions", "POST", {
            promo_codes: addedCodes,
          });

        const currentMethods = shippingQuote.selectedShippingMethods;
        const currentMethodByOption = new Map(
          currentMethods.flatMap((method) =>
            method.shippingOptionId
              ? [[method.shippingOptionId, method] as const]
              : [],
          ),
        );
        const customAmounts = new Map(
          nextShippingCustomAmounts.map(({ shippingOptionId, amount }) => [
            shippingOptionId,
            amount,
          ]),
        );
        const nextOptionSet = new Set(nextShippingOptionIds);
        const shippingOptionsToAdd = new Set<string>();
        for (const method of currentMethods) {
          const optionId = method.shippingOptionId;
          if (!optionId || !nextOptionSet.has(optionId)) {
            await mutateDraftOrderEdit(
              orderId,
              `/shipping-methods/method/${encodeURIComponent(method.id)}`,
              "DELETE",
            );
            continue;
          }
          const customAmount = customAmounts.get(optionId);
          if (method.isCustomAmount && customAmount === undefined) {
            await mutateDraftOrderEdit(
              orderId,
              `/shipping-methods/method/${encodeURIComponent(method.id)}`,
              "DELETE",
            );
            currentMethodByOption.delete(optionId);
            shippingOptionsToAdd.add(optionId);
          } else if (
            customAmount !== undefined &&
            (!method.isCustomAmount || method.amount !== customAmount)
          ) {
            await mutateDraftOrderEdit(
              orderId,
              `/shipping-methods/method/${encodeURIComponent(method.id)}`,
              "POST",
              { custom_amount: customAmount },
            );
          }
        }
        for (const optionId of nextShippingOptionIds) {
          if (
            !currentMethodByOption.has(optionId) ||
            shippingOptionsToAdd.has(optionId)
          ) {
            const customAmount = customAmounts.get(optionId);
            await mutateDraftOrderEdit(orderId, "/shipping-methods", "POST", {
              shipping_option_id: optionId,
              ...(customAmount !== undefined
                ? { custom_amount: customAmount }
                : {}),
            });
          }
        }

        const toApiAddress = (address: DraftOrderAddress | null) =>
          address
            ? {
                first_name: address.firstName,
                last_name: address.lastName,
                company: address.company,
                address_1: address.address1,
                address_2: address.address2,
                city: address.city,
                province: address.province,
                postal_code: address.postalCode,
                country_code: address.countryCode,
                phone: address.phone,
              }
            : null;
        await mutateDraftOrderEdit(orderId, "", "PATCH", {
          email: String(formData.get("email") ?? ""),
          no_notification: formData.get("noNotification") === "on",
          shipping_address: toApiAddress(
            nextShippingAddress
              ? serializeDraftOrderAddress(nextShippingAddress)
              : null,
          ),
          billing_address: toApiAddress(
            nextBillingAddress
              ? serializeDraftOrderAddress(nextBillingAddress)
              : null,
          ),
        });
        await mutateDraftOrderEdit(orderId, "/confirm", "POST");
      } catch (error) {
        let cleanupMessage = "";
        if (editStarted) {
          try {
            await mutateDraftOrderEdit(orderId, "", "DELETE");
          } catch {
            cleanupMessage =
              " The edit may still be open; reload the order before retrying.";
          }
        }
        const response = {
          success: false as const,
          message: `${error instanceof Error ? error.message : "The draft order edit could not be saved"}.${cleanupMessage}`,
          data: null,
          error: "DRAFT_EDIT_FAILED",
        };
        toast.error(response.message, { position: "top-center" });
        return response;
      }
      await queryClient.invalidateQueries({ queryKey: orderQueries.all() });
      const response = {
        success: true as const,
        message: "Draft order edit confirmed",
        data: null,
        error: null,
      };
      toast.success(response.message, { position: "top-center" });
      close();
      return response;
    },
    initialState,
  );

  const serializedItems = lineItems.map((item) => {
    const quantity = Math.min(
      100_000,
      Math.max(1, Math.floor(item.quantity) || 1),
    );
    if (item.type === "custom")
      return {
        key: item.key,
        type: "custom",
        title: item.title,
        ...(item.sku.trim() ? { sku: item.sku.trim() } : {}),
        quantity,
        unitPrice: toMinorUnits(item.priceInput, currency),
      };
    return {
      key: item.key,
      type: "variant",
      variantId: item.variantId,
      ...(item.type === "variant" ? { title: item.title, sku: item.sku } : {}),
      quantity,
      customPrice: item.customPrice,
      ...(item.customPrice
        ? { unitPrice: toMinorUnits(item.priceInput, currency) }
        : {}),
    };
  });
  const serializedShippingAddress = serializeDraftOrderAddress(shippingAddress);
  const serializedBillingAddress = billingSameAsShipping
    ? serializedShippingAddress
    : serializeDraftOrderAddress(billingAddress);
  const serializedShippingCustomAmounts = shippingOptionIds.flatMap((id) => {
    const input = shippingCustomAmountInputs[id]?.trim();
    if (!input) return [];
    const majorAmount = Number(input);
    const minorAmount = Math.round(majorAmount * 10 ** currency.decimalDigits);
    return [
      {
        shippingOptionId: id,
        amount: Number.isFinite(majorAmount) ? minorAmount : Number.NaN,
      },
    ];
  });
  const shippingOptionGroups = shippingQuote
    ? shippingQuote.requiredShippingProfiles.length
      ? shippingQuote.requiredShippingProfiles.map((profile) => ({
          id: profile.id,
          name: profile.name,
          options: shippingQuote.availableOptions.filter(
            (option) => option.shippingProfileId === profile.id,
          ),
        }))
      : shippingQuote.availableOptions.length
        ? [
            {
              id: "shipping",
              name: "Shipping",
              options: shippingQuote.availableOptions,
            },
          ]
        : shippingQuote.selectedShippingOptionIds.length
          ? [{ id: "shipping", name: "Shipping", options: [] }]
          : []
    : [];

  const addVariant = (variant: (typeof variants)[number]) => {
    setLineItems((current) => {
      const existing = current.find(
        (item) => item.type === "variant" && item.variantId === variant.id,
      );
      if (existing?.type === "variant")
        return current.map((item) =>
          item.key === existing.key
            ? { ...item, quantity: item.quantity + 1 }
            : item,
        );
      return [
        ...current,
        {
          key: `variant:${variant.id}`,
          type: "variant" as const,
          variantId: variant.id,
          title: `${variant.productTitle} — ${variant.title}`,
          sku: variant.sku ?? "",
          quantity: 1,
          unitPrice: variant.unitPrice ?? 0,
          customPrice: variant.unitPrice === null,
          priceInput: String(toMajorUnits(variant.unitPrice ?? 0, currency)),
        },
      ];
    });
    setVariantQuery("");
  };

  const addPromotionCode = () => {
    const code = promotionCodeInput.trim().toUpperCase();
    if (!code || promotionCodes.includes(code)) return;
    setPromotionCodesState([...promotionCodes, code]);
    setPromotionCodeInput("");
  };

  if (itemsQuery.isPending) return <RouteSurfacePending />;
  if (shippingOptionsQuery.isPending) return <RouteSurfacePending />;
  if (shippingOptionsQuery.isError || !shippingQuote)
    return (
      <RouteSurfaceMessage>
        {shippingOptionsQuery.data && !shippingOptionsQuery.data.success
          ? shippingOptionsQuery.data.message
          : "Failed to load draft shipping options"}
      </RouteSurfaceMessage>
    );
  if (itemsQuery.isError || !itemRows)
    return (
      <RouteSurfaceMessage>
        {itemsQuery.data && !itemsQuery.data.success
          ? itemsQuery.data.message
          : "Failed to load draft order items"}
      </RouteSurfaceMessage>
    );

  return (
    <form action={formAction} className="contents">
      <input
        type="hidden"
        name="promotionCodes"
        value={JSON.stringify(promotionCodes)}
      />
      <RouteFormModal
        label={`Edit Draft Order #${order.displayId}`}
        header={
          <h2 className="text-sm font-medium">
            Edit Draft Order #{order.displayId}
          </h2>
        }
        footer={
          <DialogFooterActions
            isSheet={false}
            isLoading={pending}
            onCancel={close}
            submitLabel="Save draft"
            loadingLabel="Saving..."
          />
        }
      >
        <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 p-6">
          <div className="space-y-1">
            <h1 className="text-md font-medium">
              Edit Draft Order #{order.displayId}
            </h1>
            <p className="text-sm text-muted-foreground">
              Prices are checked again when saved. Explicit custom prices stay
              fixed; catalog prices follow the order&apos;s current market and
              customer context.
            </p>
          </div>

          <section className="grid gap-4 rounded-md border p-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="email">Customer email</Label>
              <Input
                id="email"
                name="email"
                type="email"
                variant="card"
                defaultValue={order.email ?? ""}
                placeholder="customer@example.com"
              />
            </div>
            <label className="flex items-start gap-2 text-sm">
              <input
                name="noNotification"
                type="checkbox"
                defaultChecked={order.noNotification}
                className="mt-1 size-4 accent-primary"
              />
              <span>
                Disable customer notifications
                <span className="mt-0.5 block text-xs text-muted-foreground">
                  Keep the draft silent while it is being prepared.
                </span>
              </span>
            </label>
          </section>

          <section className="space-y-4 rounded-md border p-4">
            <div>
              <h2 className="text-sm font-medium">Shipping address</h2>
              <p className="text-xs text-muted-foreground">
                Address changes are saved with a new order version.
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

          <section className="space-y-4 rounded-md border p-4">
            <div>
              <h2 className="text-sm font-medium">Shipping methods</h2>
              <p className="text-xs text-muted-foreground">
                Options are checked against the saved address, shipping
                profiles, and this order&apos;s current products when you save.
              </p>
            </div>
            {shippingQuote.hasCustomShippingMethod ? (
              <p role="alert" className="text-sm text-destructive">
                This draft has a custom shipping charge. It must be converted to
                a configured shipping option before these changes can be saved.
              </p>
            ) : null}
            {shippingOptionGroups.map((group) => {
              const selectedId = shippingOptionIds.find((id) => {
                const availableOption = shippingQuote.availableOptions.find(
                  (option) => option.id === id,
                );
                const savedMethod = shippingQuote.selectedShippingMethods.find(
                  (method) => method.shippingOptionId === id,
                );
                const profileId =
                  availableOption?.shippingProfileId ??
                  savedMethod?.shippingProfileId;
                return group.id === "shipping" || profileId === group.id;
              });
              const selectedIsUnavailable = Boolean(
                selectedId &&
                !shippingQuote.availableOptions.some(
                  (option) => option.id === selectedId,
                ),
              );
              const clearGroupIds = new Set([
                ...group.options.map((option) => option.id),
                ...shippingQuote.selectedShippingMethods
                  .filter((method) =>
                    group.id === "shipping"
                      ? true
                      : method.shippingProfileId === group.id,
                  )
                  .flatMap((method) =>
                    method.shippingOptionId ? [method.shippingOptionId] : [],
                  ),
              ]);
              const selectedOption = group.options.find(
                (option) => option.id === selectedId,
              );
              return (
                <div key={group.id} className="space-y-2">
                  <Label htmlFor={`shipping-method-${group.id}`}>
                    {group.name}
                  </Label>
                  <Select
                    value={selectedId ?? "__none__"}
                    onValueChange={(value) => {
                      const remaining = shippingOptionIds.filter(
                        (id) => !clearGroupIds.has(id),
                      );
                      setShippingOptionIdsState(
                        value === "__none__"
                          ? remaining
                          : [...remaining, value],
                      );
                      setShippingCustomAmountInputsState((amounts) => {
                        const updated = {
                          ...(amounts ?? savedCustomAmountInputs),
                        };
                        for (const id of clearGroupIds) delete updated[id];
                        return updated;
                      });
                    }}
                  >
                    <SelectTrigger
                      id={`shipping-method-${group.id}`}
                      variant="card"
                    >
                      <SelectValue placeholder="Choose a shipping method" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">
                        No shipping method
                      </SelectItem>
                      {selectedIsUnavailable ? (
                        <SelectItem value={selectedId!} disabled>
                          Previously selected method unavailable
                        </SelectItem>
                      ) : null}
                      {group.options.map((option) => (
                        <SelectItem key={option.id} value={option.id}>
                          {option.name} · {formatMoney(option.amount, currency)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {selectedIsUnavailable ? (
                    <p role="status" className="text-xs text-destructive">
                      The saved method no longer matches this quote. Choose a
                      new option or clear this profile.
                    </p>
                  ) : null}
                  {selectedOption ? (
                    <div className="space-y-1">
                      <Label
                        htmlFor={`shipping-custom-amount-${group.id}`}
                        className="text-xs text-muted-foreground"
                      >
                        Custom amount (optional)
                      </Label>
                      <Input
                        id={`shipping-custom-amount-${group.id}`}
                        type="number"
                        min="0"
                        step={String(1 / 10 ** currency.decimalDigits)}
                        inputMode="decimal"
                        variant="card"
                        value={
                          shippingCustomAmountInputs[selectedOption.id] ?? ""
                        }
                        onChange={(event) =>
                          setShippingCustomAmountInputsState((amounts) => ({
                            ...(amounts ?? savedCustomAmountInputs),
                            [selectedOption.id]: event.target.value,
                          }))
                        }
                      />
                      <p className="text-xs text-muted-foreground">
                        Leave blank to use the quoted amount of{" "}
                        {formatMoney(selectedOption.amount, currency)}.
                      </p>
                    </div>
                  ) : null}
                  {!group.options.length ? (
                    <p className="text-xs text-muted-foreground">
                      No configured shipping methods are available for this
                      profile.
                    </p>
                  ) : null}
                </div>
              );
            })}
            {!shippingOptionGroups.length ? (
              <p className="text-sm text-muted-foreground">
                No shipping options are available for the saved address and
                products. You can leave the draft without a shipping method.
              </p>
            ) : null}
            {shippingOptionIds.length ? (
              <button
                type="button"
                className="text-sm text-primary underline"
                onClick={() => setShippingOptionIdsState([])}
              >
                Clear all shipping methods
              </button>
            ) : null}
          </section>

          <section className="space-y-3 rounded-md border p-4">
            <div>
              <h2 className="text-sm font-medium">Promotions</h2>
              <p className="text-xs text-muted-foreground">
                Add promotion codes to recalculate item and shipping discounts.
                Eligible automatic promotions are included when you save.
              </p>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input
                aria-label="Promotion code"
                variant="card"
                value={promotionCodeInput}
                onChange={(event) => setPromotionCodeInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    addPromotionCode();
                  }
                }}
                placeholder="Enter a promotion code"
                autoComplete="off"
              />
              <button
                type="button"
                className="rounded-md border px-3 py-2 text-sm hover:bg-muted disabled:opacity-50"
                disabled={!promotionCodeInput.trim()}
                onClick={addPromotionCode}
              >
                Add code
              </button>
            </div>
            {promotionCodes.length ? (
              <ul className="flex flex-wrap gap-2">
                {promotionCodes.map((code) => (
                  <li
                    key={code}
                    className="inline-flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-sm"
                  >
                    <span>{code}</span>
                    <button
                      type="button"
                      aria-label={`Remove ${code}`}
                      className="text-muted-foreground hover:text-foreground"
                      onClick={() =>
                        setPromotionCodesState(
                          promotionCodes.filter((value) => value !== code),
                        )
                      }
                    >
                      ×
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-muted-foreground">
                No promotion codes selected.
              </p>
            )}
          </section>

          <section className="space-y-3">
            <div className="space-y-1">
              <h2 className="text-sm font-medium">Items</h2>
              <p className="text-xs text-muted-foreground">
                {order.currencyCode.toUpperCase()} · Current draft total{" "}
                {formatMoney(order.total, currency)}
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
                      disabled={lineItems.length >= 40}
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
                          {item.title || "Custom item"}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {item.sku || "No SKU"}
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
                          <Label htmlFor={`${item.key}-title`}>
                            Item title
                          </Label>
                          <Input
                            id={`${item.key}-title`}
                            variant="card"
                            value={item.title}
                            maxLength={200}
                            onChange={(event) =>
                              setLineItems((current) =>
                                current.map((row) =>
                                  row.key === item.key && row.type === "custom"
                                    ? { ...row, title: event.target.value }
                                    : row,
                                ),
                              )
                            }
                          />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor={`${item.key}-sku`}>SKU</Label>
                          <Input
                            id={`${item.key}-sku`}
                            variant="card"
                            value={item.sku}
                            maxLength={100}
                            onChange={(event) =>
                              setLineItems((current) =>
                                current.map((row) =>
                                  row.key === item.key
                                    ? { ...row, sku: event.target.value }
                                    : row,
                                ),
                              )
                            }
                          />
                        </div>
                      </div>
                    ) : null}
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="space-y-2">
                        <Label htmlFor={`${item.key}-quantity`}>Quantity</Label>
                        <Input
                          id={`${item.key}-quantity`}
                          variant="card"
                          type="number"
                          min="1"
                          max="100000"
                          step="1"
                          value={item.quantity}
                          onChange={(event) =>
                            setLineItems((current) =>
                              current.map((row) =>
                                row.key === item.key
                                  ? {
                                      ...row,
                                      quantity: Number(event.target.value),
                                    }
                                  : row,
                              ),
                            )
                          }
                        />
                      </div>
                      {item.type === "custom" || item.customPrice ? (
                        <div className="space-y-2">
                          <Label htmlFor={`${item.key}-price`}>
                            Unit price ({order.currencyCode.toUpperCase()})
                          </Label>
                          <Input
                            id={`${item.key}-price`}
                            variant="card"
                            type="number"
                            min="0"
                            step={10 ** -currency.decimalDigits}
                            value={item.priceInput}
                            onChange={(event) =>
                              setLineItems((current) =>
                                current.map((row) =>
                                  row.key === item.key
                                    ? { ...row, priceInput: event.target.value }
                                    : row,
                                ),
                              )
                            }
                          />
                        </div>
                      ) : (
                        <p className="flex items-center text-sm">
                          Catalog price: {formatMoney(item.unitPrice, currency)}
                        </p>
                      )}
                    </div>
                    {item.type === "variant" ? (
                      <label className="flex items-center gap-2 text-xs text-muted-foreground">
                        <input
                          type="checkbox"
                          checked={item.customPrice}
                          onChange={(event) =>
                            setLineItems((current) =>
                              current.map((row) =>
                                row.key === item.key && row.type === "variant"
                                  ? {
                                      ...row,
                                      customPrice: event.target.checked,
                                    }
                                  : row,
                              ),
                            )
                          }
                        />
                        Use a custom unit price
                      </label>
                    ) : null}
                  </article>
                ))}
              </div>
            ) : (
              <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
                No items added yet. Add at least one item before saving.
              </p>
            )}
            <button
              type="button"
              className="text-sm text-primary underline disabled:text-muted-foreground"
              disabled={lineItems.length >= 40}
              onClick={() =>
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
                ])
              }
            >
              Add custom item
            </button>
            {lineItems.length >= 40 ? (
              <p className="text-xs text-muted-foreground">
                A draft can contain up to 40 line items.
              </p>
            ) : null}
          </section>

          <input
            type="hidden"
            name="items"
            value={JSON.stringify(serializedItems)}
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
            name="shippingOptionIds"
            value={JSON.stringify(shippingOptionIds)}
            readOnly
          />
          <input
            type="hidden"
            name="shippingCustomAmounts"
            value={JSON.stringify(serializedShippingCustomAmounts)}
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

const OrderEdit = () => {
  const { id } = useParams({ strict: false }) as { id: string };
  const close = useRouteModalClose();
  const queryClient = useQueryClient();
  const { data: result, isPending } = useQuery(orderQueries.detail(id));
  const order = result?.success ? result.data : null;
  const itemsQuery = useQuery({
    ...orderQueries.items({ orderId: id, page: 1, limit: 100 }),
    enabled: Boolean(order && !order.isDraftOrder),
  });
  const itemRows = itemsQuery.data?.success ? itemsQuery.data.data.items : null;
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [removedItems, setRemovedItems] = useState<string[]>([]);
  useEffect(() => {
    if (!itemRows) return;
    setQuantities(
      Object.fromEntries(
        itemRows.map((item) => [item.id, String(item.quantity)]),
      ),
    );
    setRemovedItems([]);
  }, [itemRows]);
  useCloseOnEscape(close);
  const [editState, formAction, editPending] = useActionState(
    async (
      _state: RouteFormState,
      formData: FormData,
    ): Promise<RouteFormState> => {
      if (!order) return { success: false, message: "Order not found" };
      const email = String(formData.get("email") ?? "");
      const noNotification = formData.get("noNotification") === "on";
      const changes: OrderEditRequestBody = {};
      if (email !== (order.email ?? "")) changes.email = email;
      if (noNotification !== Boolean(order.noNotification))
        changes.no_notification = noNotification;
      const { changes: itemChanges, invalidQuantityTitle } =
        buildOrderItemChanges(itemRows, removedItems, quantities);
      if (invalidQuantityTitle)
        return {
          success: false,
          message: `${invalidQuantityTitle}: quantity must be between 1 and the current quantity`,
        };
      if (itemChanges.length) changes.items = itemChanges;
      if (Object.keys(changes).length === 0) {
        close();
        return { success: true, message: "No order changes to submit" };
      }
      try {
        await requestCustomerOrderEdit(id, changes);
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : "The order edit request could not be saved";
        toast.error(message, { position: "top-center" });
        return { success: false, message };
      }
      await queryClient.invalidateQueries({ queryKey: orderQueries.all() });
      toast.success("Order edit request sent for customer review", {
        position: "top-center",
      });
      close();
      return {
        success: true,
        message: "Order edit request sent for customer review",
      };
    },
    initialState,
  );
  if (isPending) return <RouteSurfacePending />;
  if (!order)
    return (
      <RouteSurfaceMessage>
        {result?.message ?? "Order not found"}
      </RouteSurfaceMessage>
    );
  if (order.isDraftOrder) return <DraftOrderEdit order={order} orderId={id} />;
  const { changes: itemChanges } = buildOrderItemChanges(
    itemRows,
    removedItems,
    quantities,
  );
  return (
    <form action={formAction} className="contents">
      <RouteFormModal
        label={`Edit Order #${order.displayId}`}
        header={
          <h2 className="text-sm font-medium">Edit Order #{order.displayId}</h2>
        }
        footer={
          <DialogFooterActions
            isSheet={false}
            isLoading={editPending}
            onCancel={close}
            submitLabel="Request changes"
            loadingLabel="Sending..."
          />
        }
      >
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 p-6">
          <div>
            <h1 className="text-md font-medium">
              Edit Order #{order.displayId}
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Customer approval is required before the order changes are
              applied.
            </p>
          </div>
          <section className="grid gap-4 rounded-md border p-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="order-email">Customer email</Label>
              <Input
                id="order-email"
                name="email"
                type="email"
                variant="card"
                defaultValue={order.email ?? ""}
              />
            </div>
            <label className="flex items-start gap-2 text-sm">
              <input
                name="noNotification"
                type="checkbox"
                defaultChecked={order.noNotification}
                className="mt-1 size-4 accent-primary"
              />
              <span>Disable customer notifications</span>
            </label>
          </section>
          <section className="space-y-3 rounded-md border p-4">
            <div>
              <h2 className="text-sm font-medium">Items</h2>
              <p className="mt-1 text-xs text-muted-foreground">
                Reduce quantity or remove an unfulfilled item. Requests that
                require payment, promotion, fulfillment, or shipping changes
                will be rejected for review.
              </p>
            </div>
            {itemsQuery.isPending ? <RouteSurfacePending /> : null}
            {itemsQuery.isError ||
            (itemsQuery.data && !itemsQuery.data.success) ? (
              <p role="alert" className="text-sm text-destructive">
                {itemsQuery.data && !itemsQuery.data.success
                  ? itemsQuery.data.message
                  : "Failed to load order items"}
              </p>
            ) : null}
            {itemRows?.map((item) => {
              const removed = removedItems.includes(item.id);
              const isEditable =
                order.status === "pending" && item.fulfilledQuantity === 0;
              return (
                <div
                  key={item.id}
                  className="grid gap-3 border-t pt-3 sm:grid-cols-[minmax(0,1fr)_8rem_auto] sm:items-center"
                >
                  <div
                    className={
                      removed ? "text-muted-foreground line-through" : ""
                    }
                  >
                    <p className="text-sm font-medium">{item.title}</p>
                    {item.sku ? (
                      <p className="text-xs text-muted-foreground">
                        SKU {item.sku}
                      </p>
                    ) : null}
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor={`quantity-${item.id}`} className="text-xs">
                      Quantity
                    </Label>
                    <Input
                      id={`quantity-${item.id}`}
                      type="number"
                      min={1}
                      max={item.quantity}
                      step={1}
                      variant="card"
                      disabled={!isEditable || removed}
                      value={quantities[item.id] ?? String(item.quantity)}
                      onChange={(event) =>
                        setQuantities((current) => ({
                          ...current,
                          [item.id]: event.target.value,
                        }))
                      }
                    />
                  </div>
                  {isEditable ? (
                    <button
                      type="button"
                      className="text-sm text-destructive underline disabled:opacity-50"
                      onClick={() =>
                        setRemovedItems((current) =>
                          removed
                            ? current.filter((id) => id !== item.id)
                            : [...current, item.id],
                        )
                      }
                    >
                      {removed ? "Restore" : "Remove"}
                    </button>
                  ) : (
                    <span className="text-xs text-muted-foreground">
                      This item has fulfillment activity.
                    </span>
                  )}
                </div>
              );
            })}
            {itemRows?.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                This order has no items.
              </p>
            ) : null}
          </section>
          <input
            type="hidden"
            name="items"
            value={JSON.stringify(itemChanges)}
          />
          {editState.message ? (
            <p role="alert" className="text-sm text-destructive">
              {editState.message}
            </p>
          ) : null}
        </div>
      </RouteFormModal>
    </form>
  );
};

export default OrderEdit;
