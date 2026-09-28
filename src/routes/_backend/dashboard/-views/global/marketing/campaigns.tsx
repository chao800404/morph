import { Badge } from "@/components/ui/badge";
import type { CampaignDTO } from "@/lib/promotion/dto/campaign.dto";
import type { DashboardSearch } from "@/lib/validations/dashboard-search";
import {
  CollectionCreateButton,
  DataTableCard,
  useCollectionDetailPreload,
  type DataTableColumn,
  type DataTableFilterDefinition,
} from "@/routes/_backend/dashboard/-components/data-table-card";
import {
  campaignQueries,
  normalizeCampaignListParams,
} from "@queries/campaign.queries";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { useCallback, useMemo } from "react";

const campaignStatus = (campaign: CampaignDTO, now = Date.now()) => {
  if (campaign.startsAt && new Date(campaign.startsAt).getTime() > now)
    return "Scheduled";
  if (campaign.endsAt && new Date(campaign.endsAt).getTime() < now)
    return "Expired";
  return "Active";
};

const Campaigns = () => {
  const search = useSearch({ strict: false }) as DashboardSearch;
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const preloadDetail = useCollectionDetailPreload("campaigns");
  const params = normalizeCampaignListParams(search);
  const { data: result, isPending } = useQuery(campaignQueries.list(params));
  const invalidate = useCallback(
    () =>
      void queryClient.invalidateQueries({ queryKey: campaignQueries.all() }),
    [queryClient],
  );
  const columns = useMemo<DataTableColumn<CampaignDTO>[]>(
    () => [
      {
        key: "name",
        header: "Name",
        className: "font-medium",
        cell: (row) => row.name,
      },
      {
        key: "identifier",
        header: "Identifier",
        className: "text-muted-foreground",
        cell: (row) => row.identifier,
      },
      {
        key: "status",
        header: "Status",
        className: "w-32",
        cell: (row) => {
          const status = campaignStatus(row);
          return (
            <Badge variant={status === "Active" ? "success" : "neutral"}>
              {status}
            </Badge>
          );
        },
      },
      {
        key: "schedule",
        header: "Schedule",
        className: "w-56 text-muted-foreground",
        cell: (row) =>
          `${row.startsAt ? new Date(row.startsAt).toLocaleDateString() : "Immediately"} – ${row.endsAt ? new Date(row.endsAt).toLocaleDateString() : "No end date"}`,
      },
      {
        key: "budget",
        header: "Budget",
        className: "w-36 text-muted-foreground",
        cell: (row) =>
          row.budget
            ? `${row.budget.used} / ${row.budget.limit ?? "Unlimited"} ${row.budget.type.includes("spend") ? (row.budget.currencyCode ?? "").toUpperCase() : "uses"}`.trim()
            : "No budget",
      },
    ],
    [],
  );
  const filters = useMemo<DataTableFilterDefinition[]>(
    () => [
      {
        key: "status",
        label: "Status",
        options: [
          { value: "active", label: "Active" },
          { value: "scheduled", label: "Scheduled" },
          { value: "expired", label: "Expired" },
        ],
        values: search.campaignStatus ? [search.campaignStatus] : [],
        multiple: false,
        onValuesChange: (values) => {
          void navigate({
            to: ".",
            search: (previous: DashboardSearch) => ({
              ...previous,
              campaignStatus: values.at(-1) as
                DashboardSearch["campaignStatus"] | undefined,
              page: undefined,
            }),
            replace: true,
          });
        },
      },
    ],
    [navigate, search.campaignStatus],
  );
  const rows = result?.success ? result.data.campaigns : [];

  return (
    <DataTableCard
      label="Campaigns"
      description="Organize promotions into scheduled campaigns and track usage or spend limits."
      headerActions={<CollectionCreateButton slug="campaigns" />}
      searchPlaceholder="Search campaigns"
      filters={filters}
      sortOptions={[
        { value: "name", label: "Name" },
        { value: "identifier", label: "Identifier" },
        { value: "createdAt", label: "Created" },
        { value: "updatedAt", label: "Updated" },
      ]}
      columns={columns}
      rows={rows}
      getRowId={(row) => row.id}
      isPending={isPending}
      errorMessage={result && !result.success ? result.message : null}
      onRetry={invalidate}
      emptyTitle="No campaigns yet"
      emptyDescription="Create a campaign to group and manage promotions."
      onRowClick={(row) =>
        void navigate({
          to: "/dashboard/$slug/$id",
          params: { slug: "campaigns", id: row.id },
        })
      }
      onRowPreload={(row) => preloadDetail(row.id)}
      pagination={result?.success ? result.data.pagination : undefined}
    />
  );
};

export default Campaigns;
