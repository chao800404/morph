import { RouteSurfaceMessage } from "@/components/dialog/route-surface-message";
import {
  RouteFormPage,
  useRouteModalClose,
  type RouteFormState,
} from "@/components/dialog/route-form-modal";
import { RouteSurfacePending } from "@/components/dialog/route-surface-pending";
import { shippingOptionTypeQueries } from "@queries/shipping-option-type.queries";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "@tanstack/react-router";
import { toast } from "sonner";
import { shippingOptionTypeFormFields } from "./config/shipping-option-type-form-fields";
import { updateShippingOptionTypeAction } from "./shipping-option-type-actions";

export default function ShippingOptionTypeEdit() {
  const { id } = useParams({ strict: false }) as { id: string };
  const close = useRouteModalClose();
  const client = useQueryClient();
  const { data: result, isPending } = useQuery(
    shippingOptionTypeQueries.detail(id),
  );
  if (isPending) return <RouteSurfacePending />;
  const type = result?.success ? result.data : null;
  if (!type) {
    return (
      <RouteSurfaceMessage>
        {result?.message ?? "Shipping option type not found"}
      </RouteSurfaceMessage>
    );
  }
  const submit = async (
    _state: RouteFormState,
    form: FormData,
  ): Promise<RouteFormState> => {
    form.set("id", id);
    form.set("expectedUpdatedAt", type.updatedAt);
    const response = await updateShippingOptionTypeAction(form);
    if (!response.success) return response;
    await Promise.all([
      client.invalidateQueries({ queryKey: shippingOptionTypeQueries.all() }),
      client.invalidateQueries({ queryKey: ["location-shipping-options"] }),
    ]);
    toast.success(response.message);
    close();
    return response;
  };
  return (
    <RouteFormPage
      title="Edit Shipping Option Type"
      description={type.label}
      action={submit}
      submitLabel="Save"
      loadingLabel="Saving..."
      fields={shippingOptionTypeFormFields(type)}
    />
  );
}
