import { RouteFormPage, useRouteModalClose, type RouteFormState } from "@/components/dialog/route-form-modal";
import { orderQueries } from "@queries/marketing.queries";
import { createOrder } from "@/server/marketing/orders.serverFn";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { orderFormFields } from "./config/order-form-fields";

const OrderCreate = () => {
  const close = useRouteModalClose(); const queryClient = useQueryClient();
  const submit = async (_state: RouteFormState, formData: FormData): Promise<RouteFormState> => {
    const result = await createOrder({ data: { email: String(formData.get("email") ?? ""), currencyCode: String(formData.get("currencyCode") ?? "usd"), status: String(formData.get("status") ?? "draft") as "draft" | "pending", noNotification: formData.get("noNotification") === "on", itemTitle: String(formData.get("itemTitle") ?? ""), itemSku: String(formData.get("itemSku") ?? ""), quantity: Number(formData.get("quantity") ?? 1), unitPrice: Math.round(Number(formData.get("unitPrice") ?? 0) * 100) } });
    if (!result.success) { toast.error(result.message, { position: "top-center" }); return result; }
    await queryClient.invalidateQueries({ queryKey: orderQueries.all() }); toast.success(result.message, { position: "top-center" }); close(); return result;
  };
  return <RouteFormPage title="Create Draft Order" description="Start a manual order with customer and item information. Amounts are entered in the selected currency." submitLabel="Create draft" loadingLabel="Creating..." action={submit} fieldsClassName="grid-cols-2" fields={orderFormFields({ mode: "create" })} />;
};
export default OrderCreate;
