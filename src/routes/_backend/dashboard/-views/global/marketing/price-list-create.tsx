import {
  RouteFormPage,
  useRouteModalClose,
  type RouteFormState,
} from "@/components/dialog/route-form-modal";
import { RouteSurfaceMessage } from "@/components/dialog/route-surface-message";
import { RouteSurfacePending } from "@/components/dialog/route-surface-pending";
import { customerGroupQueries, normalizeCustomerGroupListParams } from "@queries/customer.queries";
import { normalizeRegionListParams, regionQueries } from "@queries/region.queries";
import { priceListQueries } from "@queries/price-list.queries";
import { createPriceList } from "@/server/pricing/price-lists.serverFn";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { parseFormDate, parseFormGroupIds, parseFormRegionIds, priceListFormFields } from "./price-list-form-fields";

export default function PriceListCreate() {
  const close = useRouteModalClose();
  const queryClient = useQueryClient();
  const groupsQuery = useQuery(customerGroupQueries.list(normalizeCustomerGroupListParams({ limit: 100 })));
  const regionsQuery = useQuery(regionQueries.list(normalizeRegionListParams({ limit: 100 })));
  if (groupsQuery.isPending || regionsQuery.isPending) return <RouteSurfacePending />;
  if (!groupsQuery.data?.success)
    return <RouteSurfaceMessage>{groupsQuery.data?.message ?? "Customer groups could not be loaded"}</RouteSurfaceMessage>;
  if (!regionsQuery.data?.success)
    return <RouteSurfaceMessage>{regionsQuery.data?.message ?? "Regions could not be loaded"}</RouteSurfaceMessage>;
  const groups = groupsQuery.data.data.groups.map((group) => ({ id: group.id, value: group.name }));
  const regions = regionsQuery.data.data.regions.map((region) => ({ id: region.id, value: region.name }));
  const submit = async (_state: RouteFormState, formData: FormData): Promise<RouteFormState> => {
    const response = await createPriceList({
      data: {
        title: String(formData.get("title") ?? ""),
        description: String(formData.get("description") ?? ""),
        type: formData.get("type") === "override" ? "override" : "sale",
        status: formData.get("status") === "active" ? "active" : "draft",
        startsAt: parseFormDate(formData.get("startsAt")),
        endsAt: parseFormDate(formData.get("endsAt")),
        customerGroupIds: parseFormGroupIds(formData.get("customerGroupIds")),
        regionIds: parseFormRegionIds(formData.get("regionIds")),
      },
    });
    if (!response.success) {
      toast.error(response.message, { position: "top-center" });
      return response;
    }
    await queryClient.invalidateQueries({ queryKey: priceListQueries.all() });
    toast.success(response.message, { position: "top-center" });
    close();
    return response;
  };
  return (
    <RouteFormPage
      title="Create Price List"
      description="Schedule sale or override prices and target customer groups or regions."
      action={submit}
      fields={priceListFormFields(groups, regions)}
    />
  );
}
