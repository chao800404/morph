import {
  RouteFormPage,
  useRouteModalClose,
  type RouteFormState,
} from "@/components/dialog/route-form-modal";
import { RouteSurfaceMessage } from "@/components/dialog/route-surface-message";
import { RouteSurfacePending } from "@/components/dialog/route-surface-pending";
import type { FormField } from "@/lib/validations/form";
import { normalizeReferenceDataListParams, referenceDataQueries } from "@queries/reference-data.queries";
import { orderQueries } from "@queries/marketing.queries";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "@tanstack/react-router";
import { toast } from "sonner";
import { createOrderReturnAction } from "./order-workflow-actions";

export default function OrderReturnCreate() {
  const { id } = useParams({ strict: false }) as { id: string };
  const close = useRouteModalClose();
  const client = useQueryClient();
  const orderQuery = useQuery(orderQueries.detail(id));
  const itemsQuery = useQuery(orderQueries.returnableItems(id));
  const reasonsQuery = useQuery(
    referenceDataQueries.list(
      normalizeReferenceDataListParams("return-reasons", { limit: 100 }),
    ),
  );
  if (orderQuery.isPending || itemsQuery.isPending || reasonsQuery.isPending)
    return <RouteSurfacePending />;
  const order = orderQuery.data?.success ? orderQuery.data.data : null;
  const items = itemsQuery.data?.success ? itemsQuery.data.data.items : [];
  const reasons = reasonsQuery.data?.success
    ? reasonsQuery.data.data.items
    : [];
  if (!order || (itemsQuery.data && !itemsQuery.data.success))
    return (
      <RouteSurfaceMessage>
        {itemsQuery.data?.message ?? orderQuery.data?.message ?? "Order not found"}
      </RouteSurfaceMessage>
    );
  if (!items.length)
    return (
      <RouteSurfaceMessage>
        This order has no delivered quantities available for return.
      </RouteSurfaceMessage>
    );

  const fields: FormField[] = [
    { type: "hidden", name: "orderId", value: id },
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
      ...(reasons.length
        ? [
            {
              type: "select" as const,
              name: `reason:${item.id}`,
              label: `Reason for ${item.title}`,
              optional: true,
              options: [
                { label: "No reason selected", value: "" },
                ...reasons.map((reason) => ({
                  label: reason.name,
                  value: reason.id,
                })),
              ],
            },
          ]
        : []),
      {
        type: "textarea",
        name: `note:${item.id}`,
        label: `Note for ${item.title}`,
        optional: true,
        rows: 2,
      },
    ]),
  ];
  const submit = async (
    state: RouteFormState,
    data: FormData,
  ): Promise<RouteFormState> => {
    const response = await createOrderReturnAction(state, data);
    if (!response.success) return response;
    await client.invalidateQueries({ queryKey: orderQueries.all() });
    toast.success(response.message, { position: "top-center" });
    close();
    return response;
  };
  return (
    <RouteFormPage
      title={`Create Return for Order #${order.displayId}`}
      description="Only delivered quantities can be returned. Receiving and any refund are recorded as separate steps."
      action={submit}
      submitLabel="Request return"
      loadingLabel="Requesting..."
      fields={fields}
    />
  );
}
