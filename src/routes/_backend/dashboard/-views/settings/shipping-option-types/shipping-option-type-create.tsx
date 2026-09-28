import {
  RouteFormPage,
  useRouteModalClose,
} from "@/components/dialog/route-form-modal";
import { shippingOptionTypeQueries } from "@queries/shipping-option-type.queries";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { shippingOptionTypeFormFields } from "./config/shipping-option-type-form-fields";
import { createShippingOptionTypeAction } from "./shipping-option-type-actions";

export default function ShippingOptionTypeCreate() {
  const client = useQueryClient();
  const close = useRouteModalClose();
  return (
    <RouteFormPage
      title="Create Shipping Option Type"
      description="Define a category that can be assigned to shipping options."
      fields={shippingOptionTypeFormFields()}
      action={async (state, form) => {
        const result = await createShippingOptionTypeAction(state, form);
        if (result.success) {
          await client.invalidateQueries({
            queryKey: shippingOptionTypeQueries.all(),
          });
          toast.success(result.message);
          close();
        }
        return result;
      }}
    />
  );
}
