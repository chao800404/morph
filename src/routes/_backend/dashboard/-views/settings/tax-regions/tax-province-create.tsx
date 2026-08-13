import {
  RouteFormPage,
  useRouteModalClose,
} from "@/components/dialog/route-form-modal";
import { taxQueries } from "@queries/tax.queries";
import { useQueryClient } from "@tanstack/react-query";
import { useParams } from "@tanstack/react-router";
import { toast } from "sonner";
import { taxProvinceFields } from "./config/tax-form-fields";
import { createTaxProvinceAction } from "./tax-actions";
export default function TaxProvinceCreate() {
  const { id } = useParams({ strict: false }) as { id: string };
  const client = useQueryClient();
  const close = useRouteModalClose();
  return (
    <RouteFormPage
      title="Create Province Tax Region"
      description="Create a sub-region to define tax rates for a province or state."
      fields={taxProvinceFields(id)}
      action={async (state, form) => {
        const value = await createTaxProvinceAction(state, form);
        if (value.success) {
          await client.invalidateQueries({ queryKey: taxQueries.all() });
          toast.success(value.message);
          close();
        }
        return value;
      }}
    />
  );
}
