import {
  RouteFormPage,
  useRouteModalClose,
} from "@/components/dialog/route-form-modal";
import { shippingProfileQueries } from "@queries/shipping-profile.queries";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { createShippingProfileAction } from "./shipping-profile-actions";
import { shippingProfileFormFields } from "./config/shipping-profile-form-fields";

export default function ShippingProfileCreate() {
  const client = useQueryClient();
  const close = useRouteModalClose();
  return (
    <RouteFormPage
      title="Create Shipping Profile"
      description="Group products that share shipping requirements."
      fields={shippingProfileFormFields()}
      action={async (state, form) => {
        const result = await createShippingProfileAction(state, form);
        if (result.success) {
          await client.invalidateQueries({
            queryKey: shippingProfileQueries.all(),
          });
          toast.success(result.message);
          close();
        }
        return result;
      }}
    />
  );
}
