import {
  RouteFormPage,
  useRouteModalClose,
} from "@/components/dialog/route-form-modal";
import { taxQueries } from "@queries/tax.queries";
import { useQueryClient } from "@tanstack/react-query";
import { useParams } from "@tanstack/react-router";
import { toast } from "sonner";
import { taxDefaultRateFields } from "./config/tax-form-fields";
import { createTaxRateAction } from "./tax-actions";
export default function TaxRateCreate() {
  const { id } = useParams({ strict: false }) as { id: string };
  const client = useQueryClient();
  const close = useRouteModalClose();
  return (
    <RouteFormPage
      title="Create Default Tax Rate"
      description="Set the rate used when no more specific tax override applies."
      fields={taxDefaultRateFields(id)}
      action={async (state, form) => {
        const value = await createTaxRateAction(state, form);
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
