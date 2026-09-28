import { Button } from "@/components/ui/button";
import type { PromotionListDTO } from "@/lib/promotion/dto/promotion.dto";
import type { DashboardSearch } from "@/lib/validations/dashboard-search";
import {
  DataTableCard,
  type DataTableColumn,
} from "@/routes/_backend/dashboard/-components/data-table-card";
import { manageCampaignPromotions } from "@/server/marketing/campaigns.serverFn";
import {
  normalizePromotionListParams,
  promotionQueries,
} from "@queries/marketing.queries";
import { campaignQueries } from "@queries/campaign.queries";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams, useSearch } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { toast } from "sonner";

const methodLabel = (row: PromotionListDTO) =>
  row.methodType === "percentage"
    ? `${row.value ?? 0}%`
    : row.methodType === "fixed"
      ? `${row.value ?? 0} ${(row.currencyCode ?? "").toUpperCase()}`.trim()
      : "—";

export default function CampaignAddPromotions() {
  const { id } = useParams({ strict: false }) as { id: string };
  const search = useSearch({ strict: false }) as DashboardSearch;
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const params = normalizePromotionListParams(search, { unassigned: true });
  const { data: result, isPending } = useQuery(promotionQueries.list(params));
  const rows = result?.success ? result.data.promotions : [];
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
        cell: (row) => (row.type === "buyget" ? "Buy X get Y" : "Standard"),
      },
      {
        key: "status",
        header: "Status",
        className: "w-28",
        cell: (row) => row.status,
      },
    ],
    [],
  );

  const addSelected = async () => {
    if (selectedIds.size === 0) return;
    const response = await manageCampaignPromotions({
      data: { id, add: [...selectedIds], remove: [] },
    });
    if (!response.success) {
      toast.error(response.message, { position: "top-center" });
      return;
    }
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: campaignQueries.all() }),
      queryClient.invalidateQueries({ queryKey: promotionQueries.all() }),
    ]);
    toast.success(`${selectedIds.size} promotion(s) added to campaign`, {
      position: "top-center",
    });
    void navigate({
      to: "/dashboard/$slug/$id",
      params: { slug: "campaigns", id },
    });
  };

  return (
    <DataTableCard
      label="Add promotions"
      description="Choose promotions that are not assigned to another campaign."
      headerActions={
        <Button
          type="button"
          variant="form"
          size="xs"
          disabled={selectedIds.size === 0}
          onClick={() => void addSelected()}
        >
          Add selected{selectedIds.size > 0 ? ` (${selectedIds.size})` : ""}
        </Button>
      }
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
      onRetry={() =>
        void queryClient.invalidateQueries({ queryKey: promotionQueries.all() })
      }
      emptyTitle="No unassigned promotions"
      emptyDescription="Create or remove a promotion from another campaign first."
      selection={{
        selectedIds,
        onChange: (ids) => setSelectedIds(new Set([...ids].slice(0, 20))),
        isRowSelectable: (row) =>
          selectedIds.has(row.id) || selectedIds.size < 20,
      }}
      pagination={result?.success ? result.data.pagination : undefined}
    />
  );
}
