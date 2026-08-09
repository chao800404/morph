import type { InventoryListItemDTO } from "@/lib/inventory/dto/inventory.dto";
import type { DashboardSearch } from "@/lib/validations/dashboard-search";
import {
  CollectionCreateButton,
  DataTableCard,
  type DataTableColumn,
} from "@/routes/_backend/dashboard/-components/data-table-card";
import {
  inventoryQueries,
  normalizeInventoryListParams,
} from "@queries/inventory.queries";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearch } from "@tanstack/react-router";
import { useCallback } from "react";

const columns: DataTableColumn<InventoryListItemDTO>[] = [
  {
    key: "title",
    header: "Title",
    className: "min-w-64 font-medium",
    cell: (item) => item.title ?? "-",
  },
  {
    key: "sku",
    header: "SKU",
    className: "w-44 text-muted-foreground",
    cell: (item) => item.sku ?? "-",
  },
  {
    key: "variants",
    header: "Variants",
    className: "w-28",
    cell: (item) => item.variantCount,
  },
  {
    key: "stocked",
    header: "In stock",
    className: "w-28",
    cell: (item) => item.stockedQuantity,
  },
  {
    key: "reserved",
    header: "Reserved",
    className: "w-28",
    cell: (item) => item.reservedQuantity,
  },
  {
    key: "available",
    header: "Available",
    className: "w-28",
    cell: (item) => item.availableQuantity,
  },
];

const Inventory = () => {
  const search = useSearch({ strict: false }) as DashboardSearch;
  const queryClient = useQueryClient();
  const params = normalizeInventoryListParams(search);
  const { data: result, isPending } = useQuery(inventoryQueries.list(params));
  const invalidate = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: inventoryQueries.all() });
  }, [queryClient]);
  const items = result?.success ? (result.data?.items ?? []) : [];

  return (
    <DataTableCard
      label="Inventory"
      description="Track stock across variants and locations."
      headerActions={<CollectionCreateButton slug="inventory" />}
      searchPlaceholder="Search inventory"
      sortOptions={[
        { value: "name", label: "Title" },
        { value: "createdAt", label: "Created" },
        { value: "updatedAt", label: "Updated" },
      ]}
      columns={columns}
      rows={items}
      getRowId={(item) => item.id}
      isPending={isPending}
      errorMessage={result && !result.success ? result.message : null}
      onRetry={invalidate}
      emptyTitle="No inventory records"
      emptyDescription="Managed product variants will appear here automatically."
      pagination={result?.success ? result.data?.pagination : undefined}
    />
  );
};

export default Inventory;
