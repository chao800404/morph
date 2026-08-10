import { RouteFormPage, useRouteModalClose, type RouteFormState } from "@/components/dialog/route-form-modal";
import { orderQueries } from "@queries/marketing.queries";
import { createOrder } from "@/server/marketing/orders.serverFn";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

const OrderCreate = () => {
  const close = useRouteModalClose(); const queryClient = useQueryClient();
  const submit = async (_state: RouteFormState, formData: FormData): Promise<RouteFormState> => {
    const result = await createOrder({ data: { email: String(formData.get("email") ?? ""), currencyCode: String(formData.get("currencyCode") ?? "usd"), status: String(formData.get("status") ?? "draft") as "draft" | "pending", noNotification: formData.get("noNotification") === "on", itemTitle: String(formData.get("itemTitle") ?? ""), itemSku: String(formData.get("itemSku") ?? ""), quantity: Number(formData.get("quantity") ?? 1), unitPrice: Math.round(Number(formData.get("unitPrice") ?? 0) * 100) } });
    if (!result.success) { toast.error(result.message, { position: "top-center" }); return result; }
    await queryClient.invalidateQueries({ queryKey: orderQueries.all() }); toast.success(result.message, { position: "top-center" }); close(); return result;
  };
  return <RouteFormPage title="Create Draft Order" description="Start a manual order with customer and item information. Amounts are entered in the selected currency." submitLabel="Create draft" loadingLabel="Creating..." action={submit} fieldsClassName="grid-cols-2" fields={[
    { type: "input", name: "email", label: "Customer email", inputType: "email", placeholder: "customer@example.com", optional: true, colSpan: 1, autoFocus: true },
    { type: "input", name: "currencyCode", label: "Currency", defaultValue: "usd", placeholder: "USD", required: true, colSpan: 1 },
    { type: "select", name: "status", label: "Status", defaultValue: "draft", required: true, colSpan: 1, options: [{ label: "Draft", value: "draft" }, { label: "Pending", value: "pending" }] },
    { type: "switch", name: "noNotification", label: "Disable notifications", description: "Do not send customer emails for this order.", defaultValue: false, colSpan: 1 },
    { type: "input", name: "itemTitle", label: "Item title", placeholder: "Custom item", optional: true, colSpan: 1 },
    { type: "input", name: "itemSku", label: "SKU", placeholder: "SKU-001", optional: true, colSpan: 1 },
    { type: "input", name: "quantity", label: "Quantity", inputType: "number", defaultValue: "1", required: true, colSpan: 1 },
    { type: "input", name: "unitPrice", label: "Unit price", inputType: "number", step: "0.01", defaultValue: "0", required: true, colSpan: 1 },
  ]} />;
};
export default OrderCreate;
