import type { PromotionListDTO } from "@/lib/promotion/dto/promotion.dto";
import type { DashboardSearch } from "@/lib/validations/dashboard-search";
import {
  CollectionCreateButton,
  DataTableCard,
  useCollectionDetailPreload,
  type DataTableColumn,
} from "@/routes/_backend/dashboard/-components/data-table-card";
import {
  normalizePromotionListParams,
  promotionQueries,
} from "@queries/marketing.queries";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { useCallback, useMemo } from "react";
import { PromotionStatusBadge } from "./status-badges";

const methodLabel = (row: PromotionListDTO) =>
  row.methodType === "percentage"
    ? `${row.value ?? 0}%`
    : row.methodType === "fixed"
      ? `${row.value ?? 0} ${(row.currencyCode ?? "").toUpperCase()}`.trim()
      : "—";

const Promotions = () => {
  const search = useSearch({ strict: false }) as DashboardSearch;
  const navigate = useNavigate();
  const preloadDetail = useCollectionDetailPreload("promotions");
  const queryClient = useQueryClient();
  const params = normalizePromotionListParams(search);
  const { data: result, isPending } = useQuery(promotionQueries.list(params));
  const invalidate = useCallback(
    () =>
      void queryClient.invalidateQueries({ queryKey: promotionQueries.all() }),
    [queryClient],
  );
  const columns = useMemo<DataTableColumn<PromotionListDTO>[]>(
    () => [
      {
        key: "code",
        header: "Code",
        className: "font-medium",
        cell: (row) => row.code,
      },
      { key: "method", header: "Method", cell: methodLabel },
      {
        key: "type",
        header: "Type",
        className: "text-muted-foreground",
        cell: (row) => (row.type === "buyget" ? "Buy X get Y" : "Standard"),
      },
      {
        key: "automatic",
        header: "Automatic",
        className: "w-28",
        cell: (row) => (row.isAutomatic ? "Yes" : "No"),
      },
      {
        key: "status",
        header: "Status",
        className: "w-32",
        cell: (row) => (
          <PromotionStatusBadge status={row.status} variant="plain" />
        ),
      },
    ],
    [],
  );
  const rows = result?.success ? result.data.promotions : [];
  return (
    <DataTableCard
      label="Promotions"
      description="Create discounts, coupons, and promotional campaigns."
      headerActions={<CollectionCreateButton slug="promotions" />}
      searchPlaceholder="Search promotions"
      sortOptions={[
        { value: "code", label: "Code" },
        { value: "createdAt", label: "Created" },
        { value: "updatedAt", label: "Updated" },
      ]}
      columns={columns}
      rows={rows}
      getRowId={(row) => row.id}
      isPending={isPending}
      errorMessage={result && !result.success ? result.message : null}
      onRetry={invalidate}
      emptyTitle="No promotions yet"
      emptyDescription="Create a promotion to offer fixed or percentage discounts."
      onRowClick={(row) =>
        void navigate({
          to: "/dashboard/$slug/$id",
          params: { slug: "promotions", id: row.id },
        })
      }
      onRowPreload={(row) => preloadDetail(row.id)}
      pagination={result?.success ? result.data.pagination : undefined}
    />
  );
};
export default Promotions;
