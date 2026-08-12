import { RouteFormPage, useRouteModalClose, type RouteFormState } from "@/components/dialog/route-form-modal";
import { RouteSurfaceMessage } from "@/components/dialog/route-surface-message";
import { RouteSurfacePending } from "@/components/dialog/route-surface-pending";
import { updateOrder } from "@/server/marketing/orders.serverFn";
import { orderQueries } from "@queries/marketing.queries";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "@tanstack/react-router";
import { toast } from "sonner";
import { orderFormFields } from "./config/order-form-fields";

const OrderEdit = () => {
  const { id } = useParams({ strict: false }) as { id: string }; const close = useRouteModalClose(); const queryClient = useQueryClient();
  const { data: result, isPending } = useQuery(orderQueries.detail(id)); const order = result?.success ? result.data : null;
  if (isPending) return <RouteSurfacePending />;
  if (!order) return <RouteSurfaceMessage>{result?.message ?? "Order not found"}</RouteSurfaceMessage>;
  const submit = async (_state: RouteFormState, formData: FormData): Promise<RouteFormState> => {
    const response = await updateOrder({ data: { id, email: String(formData.get("email") ?? ""), status: String(formData.get("status")) as typeof order.status, noNotification: formData.get("noNotification") === "on" } });
    if (!response.success) { toast.error(response.message, { position: "top-center" }); return response; }
    await queryClient.invalidateQueries({ queryKey: orderQueries.all() }); toast.success(response.message, { position: "top-center" }); close(); return response;
  };
  return <RouteFormPage title={`Edit Order #${order.displayId}`} action={submit} submitLabel="Save" loadingLabel="Saving..." fieldsClassName="grid-cols-2" fields={orderFormFields({ mode: "edit", values: order })} />;
};
export default OrderEdit;
