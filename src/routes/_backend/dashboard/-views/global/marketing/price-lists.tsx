import type { PriceListDTO } from "@/lib/pricing/dto/price-list.dto";
import type { DashboardSearch } from "@/lib/validations/dashboard-search";
import { Badge } from "@/components/ui/badge";
import { CollectionCreateButton, DataTableCard, deleteActionIcon, useCollectionDetailPreload, useCollectionEditAction, type DataTableColumn } from "@/routes/_backend/dashboard/-components/data-table-card";
import { useInfoStore } from "@/routes/_backend/dashboard/-views/features/global-info/use-info-store";
import { normalizePriceListParams, priceListQueries } from "@queries/price-list.queries";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { useCallback, useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import { deletePriceListAction } from "./price-list-actions";

const PriceLists = () => {
  const search = useSearch({ strict: false }) as DashboardSearch;
  const params = normalizePriceListParams(search);
  const { data: result, isPending } = useQuery(priceListQueries.list(params));
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const preloadDetail = useCollectionDetailPreload("price-lists");
  const editAction = useCollectionEditAction("price-lists");
  const { setInfoData, setOpen } = useInfoStore(useShallow((state) => ({ setInfoData: state.setInfoData, setOpen: state.setOpen })));
  const invalidate = useCallback(() => void queryClient.invalidateQueries({ queryKey: priceListQueries.all() }), [queryClient]);
  const columns = useMemo<DataTableColumn<PriceListDTO>[]>(() => [
    { key: "title", header: "Name", className: "w-64 font-medium", cell: (row) => row.title },
    { key: "type", header: "Type", className: "w-32", cell: (row) => row.type === "sale" ? "Sale" : "Override" },
    { key: "status", header: "Status", className: "w-28", cell: (row) => <Badge variant={row.status === "active" ? "default" : "secondary"}>{row.status === "active" ? "Active" : "Draft"}</Badge> },
    { key: "groups", header: "Customer groups", className: "w-36", cell: (row) => row.customerGroupIds.length || "All customers" },
    { key: "regions", header: "Regions", className: "w-32", cell: (row) => row.regionIds.length || "All regions" },
    { key: "prices", header: "Prices", className: "w-24 text-right", cell: (row) => row.priceCount },
    { key: "endsAt", header: "Ends", className: "w-36 text-muted-foreground", cell: (row) => row.endsAt ? new Date(row.endsAt).toLocaleDateString() : "No end date" },
  ], []);
  const rows = result?.success ? result.data.priceLists : [];
  const archive = (row: PriceListDTO) => {
    setInfoData({
      title: "Archive Price List",
      description: `Archive “${row.title}”? Its prices will stop applying to new cart calculations. Existing cart line prices are snapshots and will not change until the cart is recalculated.`,
      fields: [{ type: "hidden", name: "id", value: row.id }],
      action: deletePriceListAction,
      confirmLabel: "Archive",
      confirmVariant: "destructive",
      onSuccess: invalidate,
    });
    setOpen(true);
  };
  return (
    <DataTableCard
      label="Price Lists"
      description="Schedule sale prices or customer-specific overrides across product variants."
      headerActions={<CollectionCreateButton slug="price-lists" />}
      searchPlaceholder="Search price lists"
      sortOptions={[{ value: "name", label: "Name" }, { value: "createdAt", label: "Created" }, { value: "updatedAt", label: "Updated" }]}
      columns={columns}
      rows={rows}
      getRowId={(row) => row.id}
      isPending={isPending}
      errorMessage={result && !result.success ? result.message : null}
      onRetry={invalidate}
      emptyTitle="No price lists yet"
      emptyDescription="Create a price list to schedule sale or override prices."
      onRowClick={(row) => void navigate({ to: "/dashboard/$slug/$id", params: { slug: "price-lists", id: row.id } })}
      onRowPreload={(row) => preloadDetail(row.id)}
      rowActions={(row) => [...editAction(row.id), { label: "Archive", icon: deleteActionIcon, destructive: true, onSelect: () => archive(row) }]}
      pagination={result?.success ? result.data.pagination : undefined}
    />
  );
};

export default PriceLists;
