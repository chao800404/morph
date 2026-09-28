import type { ShippingProfileDTO } from "@/lib/shipping/dto/shipping-profile.dto";
import type { DashboardSearch } from "@/lib/validations/dashboard-search";
import type { DataTableColumn } from "@/routes/_backend/dashboard/-components/data-table-card";
import {
  normalizeShippingProfileListParams,
  shippingProfileQueries,
} from "@queries/shipping-profile.queries";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearch } from "@tanstack/react-router";
import { useCallback, useMemo } from "react";
import { SettingsResourceTable } from "../settings-resource-table";
import { deleteShippingProfilesAction } from "./shipping-profile-actions";

export default function ShippingProfiles() {
  const search = useSearch({ strict: false }) as DashboardSearch;
  const client = useQueryClient();
  const params = normalizeShippingProfileListParams(search);
  const { data: result, isPending } = useQuery(
    shippingProfileQueries.list(params),
  );
  const invalidate = useCallback(() => {
    void client.invalidateQueries({ queryKey: shippingProfileQueries.all() });
  }, [client]);
  const columns = useMemo<DataTableColumn<ShippingProfileDTO>[]>(
    () => [
      {
        key: "name",
        header: "Name",
        className: "font-medium",
        cell: (row) => row.name,
      },
      {
        key: "type",
        header: "Type",
        cell: (row) =>
          row.type === "default"
            ? "Default"
            : row.type === "gift_card"
              ? "Gift card"
              : "Custom",
      },
      {
        key: "products",
        header: "Products",
        cell: (row) => row.productCount,
      },
      {
        key: "shipping-options",
        header: "Shipping options",
        cell: (row) => row.shippingOptionCount,
      },
      {
        key: "updated",
        header: "Updated",
        cell: (row) => new Date(row.updatedAt).toLocaleDateString(),
      },
    ],
    [],
  );
  const rows = result?.success ? result.data.profiles : [];
  return (
    <SettingsResourceTable
      slug="shipping-profiles"
      label="Shipping profiles"
      description="Group products that share shipping requirements and options."
      rows={rows}
      columns={columns}
      isPending={isPending}
      errorMessage={result && !result.success ? result.message : null}
      pagination={result?.success ? result.data.pagination : undefined}
      invalidate={invalidate}
      deleteName={(row) => row.name}
      isDeleteDisabled={(row) => row.type === "default"}
      deleteAction={deleteShippingProfilesAction}
    />
  );
}
