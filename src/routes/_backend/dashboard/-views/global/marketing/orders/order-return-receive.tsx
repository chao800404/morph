import {
  RouteFormPage,
  useRouteModalClose,
  type RouteFormState,
} from "@/components/dialog/route-form-modal";
import { RouteSurfaceMessage } from "@/components/dialog/route-surface-message";
import { RouteSurfacePending } from "@/components/dialog/route-surface-pending";
import type { FormField } from "@/lib/validations/form";
import type { DashboardSearch } from "@/lib/validations/dashboard-search";
import { inventoryQueries } from "@queries/inventory.queries";
import { orderQueries } from "@queries/marketing.queries";
import {
  normalizeStockLocationListParams,
  stockLocationQueries,
} from "@queries/stock-location.queries";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams, useSearch } from "@tanstack/react-router";
import { toast } from "sonner";
import { receiveOrderReturnAction } from "./order-workflow-actions";

export default function OrderReturnReceive() {
  const { id: orderId } = useParams({ strict: false }) as { id: string };
  const search = useSearch({ strict: false }) as DashboardSearch;
  const returnId = search.returnId;
  const close = useRouteModalClose();
  const client = useQueryClient();
  const orderQuery = useQuery(orderQueries.detail(orderId));
  const returnQuery = useQuery({
    ...orderQueries.returnDetail(returnId ?? ""),
    enabled: Boolean(returnId),
  });
  const locationsQuery = useQuery(
    stockLocationQueries.list(
      normalizeStockLocationListParams({ limit: 100, sortBy: "name" }),
    ),
  );
  if (!returnId)
    return <RouteSurfaceMessage>Select a return to receive.</RouteSurfaceMessage>;
  if (
    orderQuery.isPending ||
    returnQuery.isPending ||
    locationsQuery.isPending
  )
    return <RouteSurfacePending />;
  const order = orderQuery.data?.success ? orderQuery.data.data : null;
  const orderReturn = returnQuery.data?.success
    ? returnQuery.data.data
    : null;
  const locations = locationsQuery.data?.success
    ? locationsQuery.data.data.locations
    : [];
  if (!returnId || !order || !orderReturn)
    return (
      <RouteSurfaceMessage>
        {returnQuery.data?.message ?? orderQuery.data?.message ?? "Return not found"}
      </RouteSurfaceMessage>
    );
  if (
    orderReturn.status !== "requested" &&
    orderReturn.status !== "partially_received"
  )
    return <RouteSurfaceMessage>This return is already closed.</RouteSurfaceMessage>;
  if (!locations.length)
    return <RouteSurfaceMessage>Create a stock location first.</RouteSurfaceMessage>;
  const outstandingItems = orderReturn.items.filter(
    (item) => item.quantity > item.receivedQuantity,
  );
  if (!outstandingItems.length)
    return <RouteSurfaceMessage>All return quantities are received.</RouteSurfaceMessage>;

  const fields: FormField[] = [
    { type: "hidden", name: "returnId", value: returnId },
    {
      type: "select",
      name: "locationId",
      label: "Restock location",
      required: true,
      defaultValue: orderReturn.locationId ?? "",
      options: locations.map((location) => ({
        label: location.name,
        value: location.id,
      })),
    },
    ...outstandingItems.flatMap<FormField>((item) => {
      const remaining = item.quantity - item.receivedQuantity;
      return [
        { type: "hidden", name: "returnItemId", value: item.id },
        {
          type: "input",
          name: `quantity:${item.id}`,
          label: item.title,
          description: `${remaining} unit${remaining === 1 ? "" : "s"} still expected${item.reason ? ` · ${item.reason}` : ""}`,
          inputType: "number",
          defaultValue: String(remaining),
          required: true,
        },
        {
          type: "input",
          name: `damaged:${item.id}`,
          label: `Damaged units for ${item.title}`,
          description: "Damaged units are recorded but not added to sellable stock.",
          inputType: "number",
          defaultValue: "0",
          optional: true,
        },
      ];
    }),
  ];
  const submit = async (
    state: RouteFormState,
    data: FormData,
  ): Promise<RouteFormState> => {
    const response = await receiveOrderReturnAction(state, data);
    if (!response.success) return response;
    await Promise.all([
      client.invalidateQueries({ queryKey: orderQueries.all() }),
      client.invalidateQueries({ queryKey: inventoryQueries.all() }),
    ]);
    toast.success(response.message, { position: "top-center" });
    close();
    return response;
  };
  return (
    <RouteFormPage
      title={`Receive Return #${orderReturn.displayId} for Order #${order.displayId}`}
      description="Record the quantities received and the damaged units. Undamaged stock is added to this location. Any refund uses the existing payment workflow."
      action={submit}
      submitLabel="Record receipt"
      loadingLabel="Recording..."
      fields={fields}
    />
  );
}
