import {
  RouteFormPage,
  useRouteModalClose,
  type RouteFormState,
} from "@/components/dialog/route-form-modal";
import { RouteSurfaceMessage } from "@/components/dialog/route-surface-message";
import { RouteSurfacePending } from "@/components/dialog/route-surface-pending";
import type { FormField } from "@/lib/validations/form";
import {
  normalizeStockLocationListParams,
  stockLocationQueries,
} from "@queries/stock-location.queries";
import { orderQueries } from "@queries/marketing.queries";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "@tanstack/react-router";
import { toast } from "sonner";
import { createOrderRefundClaimAction } from "./order-workflow-actions";

const reasonOptions = [
  { label: "Missing item", value: "missing_item" },
  { label: "Wrong item", value: "wrong_item" },
  { label: "Production failure", value: "production_failure" },
  { label: "Other", value: "other" },
];

export default function OrderRefundClaimCreate() {
  const { id } = useParams({ strict: false }) as { id: string };
  const close = useRouteModalClose();
  const client = useQueryClient();
  const orderQuery = useQuery(orderQueries.detail(id));
  const itemsQuery = useQuery(orderQueries.returnableItems(id));
  const locationsQuery = useQuery(
    stockLocationQueries.list(
      normalizeStockLocationListParams({ limit: 100, sortBy: "name" }),
    ),
  );
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
        This order has no delivered quantities available for a refund claim.
      </RouteSurfaceMessage>
    );
  const fields: FormField[] = [
    { type: "hidden", name: "orderId", value: id },
    ...(order.email
      ? [
          {
            type: "switch" as const,
            name: "sendNotification",
            label: "Notify customer",
            description:
              "Send a confirmation with the claim items and refund amount due. This will not process a payment refund.",
            defaultValue: false,
          },
        ]
      : []),
    {
      type: "switch",
      name: "returnItems",
      label: "Require item return",
      description: locations.length
        ? "Turn this off to record a refund claim without receiving the item back."
        : "No stock location is available, so this claim will be recorded without a physical return.",
      defaultValue: locations.length > 0,
    },
    ...(locations.length
      ? [
          {
            type: "select" as const,
            name: "locationId",
            label: "Return stock location",
            description: "Required only when Require item return is on.",
            optional: true,
            options: locations.map((location) => ({
              label: location.name,
              value: location.id,
            })),
          },
        ]
      : []),
    ...items.flatMap<FormField>((item) => [
      { type: "hidden", name: "itemId", value: item.id },
      {
        type: "input",
        name: `quantity:${item.id}`,
        label: item.title,
        description: `${item.returnableQuantity} delivered unit${item.returnableQuantity === 1 ? "" : "s"} available to return. Enter 0 to skip this item.`,
        inputType: "number",
        defaultValue: "0",
        optional: true,
      },
      {
        type: "select",
        name: `reason:${item.id}`,
        label: `Claim reason for ${item.title}`,
        optional: true,
        options: [{ label: "Select a reason", value: "" }, ...reasonOptions],
      },
      {
        type: "textarea",
        name: `note:${item.id}`,
        label: `Internal note for ${item.title}`,
        optional: true,
        rows: 2,
      },
    ]),
  ];

  const submit = async (
    state: RouteFormState,
    data: FormData,
  ): Promise<RouteFormState> => {
    const response = await createOrderRefundClaimAction(state, data);
    if (!response.success) return response;
    await client.invalidateQueries({ queryKey: orderQueries.all() });
    toast.success(response.message, { position: "top-center" });
    close();
    return response;
  };

  return (
    <RouteFormPage
      title={`Create Refund Claim for Order #${order.displayId}`}
      description="Confirming records the claim and calculates the refund from original item prices, discounts, and taxes. Choose whether the item must be returned. This does not process a payment refund; that remains due until a payment provider is configured."
      action={submit}
      submitLabel="Confirm refund claim"
      loadingLabel="Confirming..."
      fields={fields}
    />
  );
}
