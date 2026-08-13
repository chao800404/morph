import {
  RouteFormPage,
  useRouteModalClose,
  type RouteFormState,
} from "@/components/dialog/route-form-modal";
import { RouteSurfaceMessage } from "@/components/dialog/route-surface-message";
import { RouteSurfacePending } from "@/components/dialog/route-surface-pending";
import type { FormField } from "@/lib/validations/form";
import { orderQueries } from "@queries/marketing.queries";
import {
  normalizeStockLocationListParams,
  stockLocationQueries,
} from "@queries/stock-location.queries";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "@tanstack/react-router";
import { toast } from "sonner";
import { createOrderFulfillmentAction } from "./order-workflow-actions";

export default function OrderFulfill() {
  const { id } = useParams({ strict: false }) as { id: string };
  const close = useRouteModalClose();
  const client = useQueryClient();
  const orderQuery = useQuery(orderQueries.detail(id));
  const itemsQuery = useQuery(orderQueries.fulfillableItems(id));
  const locationsQuery = useQuery(
    stockLocationQueries.list(
      normalizeStockLocationListParams({ limit: 100, sortBy: "name" }),
    ),
  );
  if (orderQuery.isPending || itemsQuery.isPending || locationsQuery.isPending)
    return <RouteSurfacePending />;
  const order = orderQuery.data?.success ? orderQuery.data.data : null;
  const locations = locationsQuery.data?.success
    ? locationsQuery.data.data.locations
    : [];
  const remainingItems = itemsQuery.data?.success
    ? itemsQuery.data.data.items
    : [];
  if (!order || (itemsQuery.data && !itemsQuery.data.success))
    return (
      <RouteSurfaceMessage>
        {itemsQuery.data?.message ??
          orderQuery.data?.message ??
          "Order not found"}
      </RouteSurfaceMessage>
    );
  if (!remainingItems.length)
    return (
      <RouteSurfaceMessage>All order items are fulfilled.</RouteSurfaceMessage>
    );
  if (!locations.length)
    return (
      <RouteSurfaceMessage>Create a stock location first.</RouteSurfaceMessage>
    );
  const fields: FormField[] = [
    { type: "hidden", name: "orderId", value: id },
    {
      type: "select",
      name: "locationId",
      label: "Stock location",
      required: true,
      options: locations.map((location) => ({
        label: location.name,
        value: location.id,
      })),
    },
    ...remainingItems.flatMap<FormField>((item) => [
      { type: "hidden", name: "itemId", value: item.id },
      {
        type: "input",
        name: `quantity:${item.id}`,
        label: item.title,
        description: `${item.quantity - item.fulfilledQuantity} remaining`,
        inputType: "number",
        defaultValue: String(item.quantity - item.fulfilledQuantity),
        required: true,
      },
    ]),
  ];
  const submit = async (
    state: RouteFormState,
    data: FormData,
  ): Promise<RouteFormState> => {
    const response = await createOrderFulfillmentAction(state, data);
    if (!response.success) return response;
    await client.invalidateQueries({ queryKey: orderQueries.all() });
    toast.success(response.message, { position: "top-center" });
    close();
    return response;
  };
  return (
    <RouteFormPage
      title={`Fulfill Order #${order.displayId}`}
      description="Select the location and quantity to fulfill."
      action={submit}
      submitLabel="Create fulfillment"
      loadingLabel="Creating..."
      fields={fields}
    />
  );
}
