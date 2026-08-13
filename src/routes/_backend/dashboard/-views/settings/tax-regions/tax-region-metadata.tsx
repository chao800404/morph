import {
  RouteFormPage,
  useRouteModalClose,
} from "@/components/dialog/route-form-modal";
import { RouteSurfaceMessage } from "@/components/dialog/route-surface-message";
import { metadataFields } from "@/components/form/metadata-fields";
import { taxQueries } from "@queries/tax.queries";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "@tanstack/react-router";
import { toast } from "sonner";
import { updateTaxRegionMetadataAction } from "./tax-actions";
export default function TaxRegionMetadata() {
  const { id } = useParams({ strict: false }) as { id: string };
  const client = useQueryClient();
  const close = useRouteModalClose();
  const query = useQuery(taxQueries.detail(id));
  const region = query.data?.success ? query.data.data : null;
  if (!region)
    return (
      <RouteSurfaceMessage>
        {query.data?.message ?? "Tax region not found"}
      </RouteSurfaceMessage>
    );
  return (
    <RouteFormPage
      title="Edit Metadata"
      description={
        region.provinceCode
          ? `${region.countryName} — ${region.provinceCode}`
          : region.countryName
      }
      submitLabel="Save"
      loadingLabel="Saving..."
      fields={metadataFields(region.metadata)}
      action={async (_, form) => {
        form.set("id", id);
        const value = await updateTaxRegionMetadataAction({ data: form });
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
