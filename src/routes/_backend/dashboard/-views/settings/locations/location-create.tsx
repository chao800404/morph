import {
  RouteFormPage,
  useRouteModalClose,
} from "@/components/dialog/route-form-modal";
import { stockLocationQueries } from "@queries/stock-location.queries";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { createLocationAction } from "../commerce-actions";
export default function LocationCreate() {
  const client = useQueryClient();
  const close = useRouteModalClose();
  return (
    <RouteFormPage
      title="Create Location"
      description="Add a warehouse, store, or other inventory location."
      fieldsClassName="md:grid-cols-2"
      fields={[
        {
          type: "input",
          name: "name",
          label: "Name",
          required: true,
          autoFocus: true,
          colSpan: 2,
        },
        {
          type: "input",
          name: "address1",
          label: "Street address",
          required: true,
          colSpan: 2,
        },
        {
          type: "input",
          name: "address2",
          label: "Address line 2",
          colSpan: 2,
        },
        { type: "input", name: "city", label: "City" },
        { type: "input", name: "province", label: "Province / State" },
        { type: "input", name: "postalCode", label: "Postal code" },
        {
          type: "input",
          name: "countryCode",
          label: "Country code",
          placeholder: "US",
          required: true,
        },
      ]}
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
