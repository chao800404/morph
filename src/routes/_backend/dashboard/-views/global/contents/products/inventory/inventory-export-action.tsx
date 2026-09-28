import { AsyncCsvExportAction } from "@/routes/_backend/dashboard/-components/async-csv-export-action";

export function InventoryExportAction({
  filters,
}: {
  filters: { q?: string; order: string };
}) {
  return (
    <AsyncCsvExportAction
      kind="inventory-items"
      resourceLabel="inventory"
      description="Create a CSV with inventory details and quantities for each stock location. The current search is applied to the export."
      filters={filters}
    />
  );
}
