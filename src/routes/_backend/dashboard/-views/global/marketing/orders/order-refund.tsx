import {
  RouteFormPage,
  useRouteModalClose,
  type RouteFormState,
} from "@/components/dialog/route-form-modal";
import { RouteSurfaceMessage } from "@/components/dialog/route-surface-message";
import { RouteSurfacePending } from "@/components/dialog/route-surface-pending";
import type { FormField } from "@/lib/validations/form";
import { orderQueries } from "@queries/marketing.queries";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "@tanstack/react-router";
import { toast } from "sonner";
import { refundOrderPaymentAction } from "./order-workflow-actions";

export default function OrderRefund() {
  const { id } = useParams({ strict: false }) as { id: string };
  const close = useRouteModalClose();
  const client = useQueryClient();
  const { data: result, isPending } = useQuery(orderQueries.detail(id));
  const order = result?.success ? result.data : null;
  if (isPending) return <RouteSurfacePending />;
  if (!order)
    return (
      <RouteSurfaceMessage>
        {result?.message ?? "Order not found"}
      </RouteSurfaceMessage>
    );
  const refundable = Math.max(
    0,
    (order.payment?.capturedAmount ?? 0) - (order.payment?.refundedAmount ?? 0),
  );
  if (!refundable)
    return (
      <RouteSurfaceMessage>
        No captured payment is refundable.
      </RouteSurfaceMessage>
    );
  const fields: FormField[] = [
    { type: "hidden", name: "orderId", value: id },
    {
      type: "input",
      name: "amount",
      label: "Refund amount",
      inputType: "number",
      defaultValue: String(refundable),
      required: true,
      autoFocus: true,
    },
    {
      type: "textarea",
      name: "note",
      label: "Internal note",
      optional: true,
      placeholder: "Reason for this refund",
    },
  ];
  const submit = async (
    state: RouteFormState,
    data: FormData,
  ): Promise<RouteFormState> => {
    const response = await refundOrderPaymentAction(state, data);
    if (!response.success) return response;
    await client.invalidateQueries({ queryKey: orderQueries.all() });
    toast.success(response.message, { position: "top-center" });
    close();
    return response;
  };
  return (
    <RouteFormPage
      title={`Refund Order #${order.displayId}`}
      description={`Up to ${refundable} minor currency units can be refunded.`}
      action={submit}
      submitLabel="Refund"
      loadingLabel="Refunding..."
      fields={fields}
    />
  );
}
