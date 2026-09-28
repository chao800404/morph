import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { findCurrency, formatMoney } from "@/lib/currency/catalog";
import type { CampaignDTO } from "@/lib/promotion/dto/campaign.dto";
import type { PromotionListDTO } from "@/lib/promotion/dto/promotion.dto";
import type { DashboardSearch } from "@/lib/validations/dashboard-search";
import { findCollection } from "@/lib/config/navigation";
import { viewPreloader } from "@/lib/config/lazy-view";
import { CardWrapper } from "@/routes/_backend/dashboard/-components/card-wrapper";
import {
  DataTableCard,
  deleteActionIcon,
  type DataTableColumn,
} from "@/routes/_backend/dashboard/-components/data-table-card";
import {
  EditCard,
  type EditCardField,
} from "@/routes/_backend/dashboard/-components/edit-card/edit-card";
import { useInfoStore } from "@/routes/_backend/dashboard/-views/features/global-info/use-info-store";
import { getConfig } from "@/server/get-config";
import {
  deleteCampaign,
  manageCampaignPromotions,
} from "@/server/marketing/campaigns.serverFn";
import {
  normalizePromotionListParams,
  promotionQueries,
} from "@queries/marketing.queries";
import { campaignQueries } from "@queries/campaign.queries";
import {
  useQuery,
  useQueryClient,
  useSuspenseQuery,
} from "@tanstack/react-query";
import {
  Link,
  useNavigate,
  useParams,
  useRouter,
  useSearch,
} from "@tanstack/react-router";
import { useCallback, useMemo } from "react";
import { toast } from "sonner";
import { useShallow } from "zustand/react/shallow";

const statusOf = (campaign: CampaignDTO) => {
  const now = Date.now();
  if (campaign.startsAt && new Date(campaign.startsAt).getTime() > now)
    return "Scheduled";
  if (campaign.endsAt && new Date(campaign.endsAt).getTime() < now)
    return "Expired";
  return "Active";
};

const budgetLabel = (campaign: CampaignDTO) => {
  const budget = campaign.budget;
  if (!budget) return "No budget";
  const limit = budget.limit === null ? "Unlimited" : String(budget.limit);
  const spent = budget.type.includes("spend");
  const currency = budget.currencyCode?.toUpperCase() ?? "";
  const attribute = budget.attribute === "email" ? "per email" : "per customer";
  const scope = budget.type.includes("attribute") ? ` ${attribute}` : "";
  return `${budget.used} / ${limit}${spent ? ` ${currency}` : " uses"}${scope}`.trim();
};

const formatPromotionMethod = (row: PromotionListDTO) =>
  row.methodType === "percentage"
    ? `${row.value ?? 0}%`
    : row.methodType === "fixed"
      ? `${row.value ?? 0} ${(row.currencyCode ?? "").toUpperCase()}`.trim()
      : "—";

export default function CampaignDetail() {
  const { id } = useParams({ strict: false }) as { id: string };
  const search = useSearch({ strict: false }) as DashboardSearch;
  const { data: campaignResult } = useSuspenseQuery(campaignQueries.detail(id));
  const campaign = campaignResult.success ? campaignResult.data : null;
  const promotionParams = normalizePromotionListParams(search, {
    campaignId: id,
  });
  const promotionsQuery = useQuery(promotionQueries.list(promotionParams));
  const promotionsResult = promotionsQuery.data;
  const promotions = promotionsResult?.success
    ? promotionsResult.data.promotions
    : [];
  const queryClient = useQueryClient();
  const router = useRouter();
  const navigate = useNavigate();
  const editView = useMemo(
    () =>
      findCollection(getConfig().client.collections.global, "campaigns")?.edit
        ?.view,
    [],
  );
  const openEdit = useCallback(
    () =>
      void navigate({
        to: "/dashboard/$slug/$id/edit",
        params: { slug: "campaigns", id },
      }),
    [id, navigate],
  );
  const preloadEdit = useCallback(() => {
    void viewPreloader(editView)?.();
    void router.preloadRoute({
      to: "/dashboard/$slug/$id/edit",
      params: { slug: "campaigns", id },
    });
  }, [editView, id, router]);
  const { setInfoData, setOpen } = useInfoStore(
    useShallow((state) => ({
      setInfoData: state.setInfoData,
      setOpen: state.setOpen,
    })),
  );
  const invalidate = useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: campaignQueries.all() }),
      queryClient.invalidateQueries({ queryKey: promotionQueries.all() }),
    ]);
  }, [queryClient]);

  const removeCampaign = useCallback(() => {
    setInfoData({
      title: "Delete Campaign",
      description:
        "Delete this campaign? Its promotions will remain and become unassigned.",
      fields: [],
      action: async () => {
        const response = await deleteCampaign({ data: { id } });
        return { success: response.success, message: response.message };
      },
      confirmLabel: "Delete",
      confirmVariant: "destructive",
      onSuccess: () => {
        toast.success("Campaign deleted");
        void navigate({
          to: "/dashboard/$slug",
          params: { slug: "campaigns" },
        });
      },
    });
    setOpen(true);
  }, [id, navigate, setInfoData, setOpen]);

  const removePromotion = useCallback(
    (promotion: PromotionListDTO) => {
      setInfoData({
        title: "Remove Promotion",
        description: `Remove “${promotion.code}” from this campaign? The promotion itself will remain available.`,
        fields: [],
        action: async () => {
          const response = await manageCampaignPromotions({
            data: { id, add: [], remove: [promotion.id] },
          });
          if (response.success) await invalidate();
          return { success: response.success, message: response.message };
        },
        confirmLabel: "Remove",
        confirmVariant: "destructive",
        onSuccess: () => {
          void invalidate();
          toast.success("Promotion removed from campaign");
        },
      });
      setOpen(true);
    },
    [id, invalidate, setInfoData, setOpen],
  );

  const columns = useMemo<DataTableColumn<PromotionListDTO>[]>(
    () => [
      {
        key: "code",
        header: "Code",
        className: "font-medium",
        cell: (row) => row.code,
      },
      { key: "method", header: "Method", cell: formatPromotionMethod },
      {
        key: "type",
        header: "Type",
        cell: (row) => (row.type === "buyget" ? "Buy X get Y" : "Standard"),
      },
      {
        key: "status",
        header: "Status",
        className: "w-28",
        cell: (row) => (
          <Badge variant={row.status === "active" ? "success" : "neutral"}>
            {row.status}
          </Badge>
        ),
      },
    ],
    [],
  );

  if (!campaign)
    return (
      <CardWrapper label="Campaign">
        <p className="border-t px-6 py-4 text-sm text-muted-foreground">
          {campaignResult.message ?? "Campaign not found"}
        </p>
      </CardWrapper>
    );

  const status = statusOf(campaign);
  const budgetCurrency = campaign.budget?.currencyCode
    ? findCurrency(campaign.budget.currencyCode)
    : undefined;
  const budgetValue = campaign.budget
    ? campaign.budget.limit === null
      ? "Unlimited"
      : budgetCurrency && campaign.budget.type.includes("spend")
        ? formatMoney(campaign.budget.limit, budgetCurrency)
        : String(campaign.budget.limit)
    : "—";
  const fields: EditCardField[] = [
    { key: "identifier", label: "Identifier", value: campaign.identifier },
    {
      key: "status",
      label: "Status",
      disabled: true,
      displayValue: (
        <Badge variant={status === "Active" ? "success" : "neutral"}>
          {status}
        </Badge>
      ),
    },
    {
      key: "startsAt",
      label: "Starts",
      value: campaign.startsAt ?? "",
      displayValue: campaign.startsAt
        ? new Date(campaign.startsAt).toLocaleString()
        : "Immediately",
    },
    {
      key: "endsAt",
      label: "Ends",
      value: campaign.endsAt ?? "",
      displayValue: campaign.endsAt
        ? new Date(campaign.endsAt).toLocaleString()
        : "No end date",
    },
    {
      key: "budgetType",
      label: "Budget type",
      value: campaign.budget?.type ?? "none",
      displayValue: campaign.budget?.type.replaceAll("_", " ") ?? "No budget",
      disabled: true,
    },
    {
      key: "budget",
      label: "Budget usage",
      value: budgetValue,
      displayValue: campaign.budget
        ? `${budgetLabel(campaign)}${campaign.budget.type.includes("spend") && budgetCurrency ? ` (${formatMoney(campaign.budget.used, budgetCurrency)} used)` : ""}`
        : "No budget",
      disabled: true,
    },
    {
      key: "description",
      label: "Description",
      value: campaign.description ?? "",
      type: "textarea",
    },
  ];

  return (
    <div className="flex flex-col gap-4">
      <EditCard
        id="campaign-general"
        title={campaign.name}
        fields={fields}
        onEdit={openEdit}
        onEditPreload={preloadEdit}
        actions={[
          {
            label: "Delete campaign",
            icon: deleteActionIcon,
            destructive: true,
            onSelect: removeCampaign,
          },
        ]}
      />
      <DataTableCard
        label="Promotions"
        description="Promotions linked to this campaign. Removing one does not delete it."
        headerActions={
          <Button variant="form" size="xs" asChild>
            <Link
              to="/dashboard/$slug/$id/$page"
              params={{ slug: "campaigns", id, page: "add-promotions" }}
            >
              Add promotions
            </Link>
          </Button>
        }
        searchPlaceholder="Search promotions"
        sortOptions={[
          { value: "code", label: "Code" },
          { value: "createdAt", label: "Created" },
          { value: "updatedAt", label: "Updated" },
        ]}
        columns={columns}
        rows={promotions}
        getRowId={(row) => row.id}
        isPending={promotionsQuery.isPending}
        errorMessage={
          promotionsResult && !promotionsResult.success
            ? promotionsResult.message
            : null
        }
        onRetry={() => void invalidate()}
        emptyTitle="No promotions in this campaign"
        emptyDescription="Add existing promotions to manage them together."
        rowActions={(row) => [
          {
            label: "Remove",
            icon: deleteActionIcon,
            destructive: true,
            onSelect: () => removePromotion(row),
          },
        ]}
        pagination={
          promotionsResult?.success
            ? promotionsResult.data.pagination
            : undefined
        }
      />
    </div>
  );
}
