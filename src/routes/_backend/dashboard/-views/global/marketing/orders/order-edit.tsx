import { RouteFormPage, useRouteModalClose, type RouteFormState } from "@/components/dialog/route-form-modal";
import { Spinner } from "@/components/ui/spinner";
import { updateOrder } from "@/server/marketing/orders.serverFn";
import { orderQueries } from "@queries/marketing.queries";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "@tanstack/react-router";
import { toast } from "sonner";

const OrderEdit = () => {
  const { id } = useParams({ strict: false }) as { id: string }; const close = useRouteModalClose(); const queryClient = useQueryClient();
  const { data: result, isPending } = useQuery(orderQueries.detail(id)); const order = result?.success ? result.data : null;
  if (isPending) return <div className="flex h-full items-center justify-center"><Spinner /></div>;
  if (!order) return null;
  const submit = async (_state: RouteFormState, formData: FormData): Promise<RouteFormState> => {
    const response = await updateOrder({ data: { id, email: String(formData.get("email") ?? ""), status: String(formData.get("status")) as typeof order.status, noNotification: formData.get("noNotification") === "on" } });
    if (!response.success) { toast.error(response.message, { position: "top-center" }); return response; }
    await queryClient.invalidateQueries({ queryKey: orderQueries.all() }); toast.success(response.message, { position: "top-center" }); close(); return response;
  };
  return <RouteFormPage title={`Edit Order #${order.displayId}`} action={submit} submitLabel="Save" loadingLabel="Saving..." fieldsClassName="grid-cols-2" fields={[
    { type: "input", name: "email", label: "Customer email", inputType: "email", optional: true, colSpan: 1, defaultValue: order.email ?? "", autoFocus: true },
    { type: "select", name: "status", label: "Status", required: true, colSpan: 1, defaultValue: order.status, options: [{ label: "Draft", value: "draft" }, { label: "Pending", value: "pending" }, { label: "Requires action", value: "requires_action" }, { label: "Completed", value: "completed" }, { label: "Canceled", value: "canceled" }, { label: "Archived", value: "archived" }] },
    { type: "switch", name: "noNotification", label: "Disable notifications", description: "Do not send customer emails for this order.", defaultValue: false, colSpan: 1 },
  ]} />;
};
export default OrderEdit;
