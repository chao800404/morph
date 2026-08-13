import {
  RouteFormPage,
  useRouteModalClose,
} from "@/components/dialog/route-form-modal";
import { RouteSurfaceMessage } from "@/components/dialog/route-surface-message";
import { taxQueries } from "@queries/tax.queries";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "@tanstack/react-router";
import { toast } from "sonner";
import { taxRegionFields } from "./config/tax-form-fields";
import { updateTaxRegionAction } from "./tax-actions";

export default function TaxRegionEdit() {
  const { id } = useParams({ strict: false }) as { id: string };
  const client = useQueryClient();
  const close = useRouteModalClose();
  const regionQuery = useQuery(taxQueries.detail(id));
  const optionsQuery = useQuery(taxQueries.options());
  const region = regionQuery.data?.success ? regionQuery.data.data : null;
  if (!region)
    return (
      <RouteSurfaceMessage>
        {regionQuery.data?.message ?? "Tax region not found"}
      </RouteSurfaceMessage>
    );
  const providers = optionsQuery.data?.success
    ? optionsQuery.data.data.providers.map((item) => ({
        label: item.id.replace(/^tp_/, "").replaceAll("_", " "),
        value: item.id,
      }))
    : [];
  return (
    <RouteFormPage
      title="Edit Tax Region"
      description="Edit the tax region details."
      submitLabel="Save"
      loadingLabel="Saving..."
      fields={taxRegionFields(
        [{ label: region.countryName, value: region.countryCode }],
        providers,
        region,
      )}
      action={async (_, form) => {
        form.set("id", id);
        const value = await updateTaxRegionAction(form);
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
