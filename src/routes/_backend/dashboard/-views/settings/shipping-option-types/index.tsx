import type { ShippingOptionTypeDTO } from "@/lib/shipping/dto/shipping-option-type.dto";
import type { DashboardSearch } from "@/lib/validations/dashboard-search";
import type { DataTableColumn } from "@/routes/_backend/dashboard/-components/data-table-card";
import {
  normalizeShippingOptionTypeListParams,
  shippingOptionTypeQueries,
} from "@queries/shipping-option-type.queries";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearch } from "@tanstack/react-router";
import { useCallback, useMemo } from "react";
import { SettingsResourceTable } from "../settings-resource-table";
import { deleteShippingOptionTypeAction } from "./shipping-option-type-actions";

export default function ShippingOptionTypes() {
  const search = useSearch({ strict: false }) as DashboardSearch;
  const client = useQueryClient();
  const params = normalizeShippingOptionTypeListParams(search);
  const { data: result, isPending } = useQuery(
    shippingOptionTypeQueries.list(params),
  );
  const invalidate = useCallback(() => {
    void client.invalidateQueries({ queryKey: shippingOptionTypeQueries.all() });
    void client.invalidateQueries({ queryKey: ["location-shipping-options"] });
  }, [client]);
  const columns = useMemo<DataTableColumn<ShippingOptionTypeDTO>[]>(
    () => [
      {
        key: "label",
        header: "Label",
        className: "font-medium",
        cell: (row) => row.label,
      },
      { key: "code", header: "Code", cell: (row) => row.code },
      {
        key: "options",
        header: "Shipping options",
        cell: (row) => row.shippingOptionCount,
      },
      {
        key: "description",
        header: "Description",
        cell: (row) => row.description || "—",
      },
      {
        key: "updated",
        header: "Updated",
        cell: (row) => new Date(row.updatedAt).toLocaleDateString(),
      },
    ],
    [],
  );
  const rows = result?.success ? result.data.types : [];

  return (
    <SettingsResourceTable
      slug="shipping-option-types"
      label="Shipping option types"
      description="Group checkout shipping options into shopper-facing categories."
      rows={rows}
      columns={columns}
      isPending={isPending}
      errorMessage={result && !result.success ? result.message : null}
      pagination={result?.success ? result.data.pagination : undefined}
      invalidate={invalidate}
      deleteName={(row) => row.label}
      deleteDescription={(row) =>
        row.shippingOptionCount
          ? `“${row.label}” will be deactivated and removed from ${row.shippingOptionCount} shipping options. Their prices and availability rules will remain. This cannot be undone.`
          : `“${row.label}” will be deactivated. This cannot be undone.`
      }
      deleteFields={(row) => [
        {
          type: "hidden",
          name: "expectedUpdatedAt",
          value: row.updatedAt,
        },
      ]}
      deleteAction={deleteShippingOptionTypeAction}
    />
  );
}
