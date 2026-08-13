import {
  RouteFormPage,
  useRouteModalClose,
} from "@/components/dialog/route-form-modal";
import { RouteSurfaceMessage } from "@/components/dialog/route-surface-message";
import { taxQueries } from "@queries/tax.queries";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "@tanstack/react-router";
import { toast } from "sonner";
import {
  taxDefaultRateFields,
  taxOverrideFields,
} from "./config/tax-form-fields";
import { updateTaxRateAction } from "./tax-actions";
export default function TaxRateEdit() {
  const { id, childId } = useParams({ strict: false }) as {
    id: string;
    childId?: string;
  };
  const client = useQueryClient();
  const close = useRouteModalClose();
  const query = useQuery({
    ...taxQueries.rate(childId ?? ""),
    enabled: Boolean(childId),
  });
  const rate = query.data?.success ? query.data.data : null;
  if (!rate)
    return (
      <RouteSurfaceMessage>
        {query.data?.message ?? "Tax rate not found"}
      </RouteSurfaceMessage>
    );
  return (
    <RouteFormPage
      title={rate.isDefault ? "Edit Default Tax Rate" : "Edit Tax Override"}
      description={rate.name}
      submitLabel="Save"
      loadingLabel="Saving..."
      fields={
        rate.isDefault
          ? taxDefaultRateFields(id, rate)
          : taxOverrideFields(id, rate)
      }
      action={async (_, form) => {
        const value = await updateTaxRateAction(form);
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
