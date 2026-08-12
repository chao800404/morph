import {
  RouteFormPage,
  useRouteModalClose,
} from "@/components/dialog/route-form-modal";
import { stockLocationQueries } from "@queries/stock-location.queries";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { createLocationAction } from "../commerce-actions";
import { locationFormFields } from "./config/location-form-fields";
export default function LocationCreate() {
  const client = useQueryClient();
  const close = useRouteModalClose();
  return (
    <RouteFormPage
      title="Create Location"
      description="Add a warehouse, store, or other inventory location."
      fieldsClassName="md:grid-cols-2"
      fields={locationFormFields()}
      action={async (state, form) => {
        const value = await createLocationAction(state, form);
        if (value.success) {
          await client.invalidateQueries({
            queryKey: stockLocationQueries.all(),
          });
          toast.success(value.message);
          close();
        }
        return value;
      }}
    />
  );
}
