import {
  RouteFormPage,
  useRouteModalClose,
} from "@/components/dialog/route-form-modal";
import { RouteSurfaceMessage } from "@/components/dialog/route-surface-message";
import { taxQueries } from "@queries/tax.queries";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  formatTaxProviderLabel,
  taxRegionFields,
} from "./config/tax-form-fields";
import { createTaxRegionAction } from "./tax-actions";

export default function TaxRegionCreate() {
  const client = useQueryClient();
  const close = useRouteModalClose();
  const query = useQuery(taxQueries.options());
  if (query.isError || (query.data && !query.data.success)) {
    return (
      <RouteSurfaceMessage>
        {query.data?.message ?? "Failed to load tax region options"}
      </RouteSurfaceMessage>
    );
  }
  const countries = query.data?.success
    ? query.data.data.countries.map((item) => ({
        label: `${item.name} — ${item.code.toUpperCase()}`,
        value: item.code,
      }))
    : [];
  const providers = query.data?.success
    ? query.data.data.providers.map((item) => ({
        label: formatTaxProviderLabel(item.id),
        value: item.id,
      }))
    : [];
  return (
    <RouteFormPage
      title="Create Tax Region"
      description="Create a tax region to define tax rates for a specific country."
      fields={taxRegionFields(countries, providers)}
      action={async (state, form) => {
        const value = await createTaxRegionAction(state, form);
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
