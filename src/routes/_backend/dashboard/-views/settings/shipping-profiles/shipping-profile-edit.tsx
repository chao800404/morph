import { RouteSurfaceMessage } from "@/components/dialog/route-surface-message";
import {
  RouteFormPage,
  useRouteModalClose,
  type RouteFormState,
} from "@/components/dialog/route-form-modal";
import { RouteSurfacePending } from "@/components/dialog/route-surface-pending";
import { shippingProfileQueries } from "@queries/shipping-profile.queries";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "@tanstack/react-router";
import { toast } from "sonner";
import { updateShippingProfileAction } from "./shipping-profile-actions";
import { shippingProfileFormFields } from "./config/shipping-profile-form-fields";

export default function ShippingProfileEdit() {
  const { id } = useParams({ strict: false }) as { id: string };
  const close = useRouteModalClose();
  const client = useQueryClient();
  const { data: result, isPending } = useQuery(
    shippingProfileQueries.detail(id),
  );
  if (isPending) return <RouteSurfacePending />;
  const profile = result?.success ? result.data : null;
  if (!profile) {
    return (
      <RouteSurfaceMessage>
        {result?.message ?? "Shipping profile not found"}
      </RouteSurfaceMessage>
    );
  }
  const submit = async (
    _state: RouteFormState,
    form: FormData,
  ): Promise<RouteFormState> => {
    form.set("id", id);
    const response = await updateShippingProfileAction(form);
    if (!response.success) return response;
    await client.invalidateQueries({ queryKey: shippingProfileQueries.all() });
    toast.success(response.message);
    close();
    return response;
  };
  return (
    <RouteFormPage
      title="Edit Shipping Profile"
      description={profile.name}
      action={submit}
      submitLabel="Save"
      loadingLabel="Saving..."
      fields={shippingProfileFormFields(profile)}
    />
  );
}
