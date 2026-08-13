import {
  RouteFormPage,
  useRouteModalClose,
} from "@/components/dialog/route-form-modal";
import { taxQueries } from "@queries/tax.queries";
import { useQueryClient } from "@tanstack/react-query";
import { useParams } from "@tanstack/react-router";
import { toast } from "sonner";
import { taxOverrideFields } from "./config/tax-form-fields";
import { createTaxRateAction } from "./tax-actions";

export default function TaxOverrideCreate() {
  const { id } = useParams({ strict: false }) as { id: string };
  const client = useQueryClient();
  const close = useRouteModalClose();
  return (
    <RouteFormPage
      title="Create Tax Override"
      description="Apply a specific rate to selected products, product types, or shipping options."
      fields={taxOverrideFields(id)}
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
