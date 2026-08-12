import { Button } from "@/components/ui/button";
import { CollectionDetailSkeleton } from "@/routes/_backend/dashboard/-components/loading/collection-page-skeletons";
import { CardWrapper } from "@/routes/_backend/dashboard/-components/card-wrapper";
import {
  EditCard,
  type EditCardField,
} from "@/routes/_backend/dashboard/-components/edit-card/edit-card";
import { promotionQueries } from "@queries/marketing.queries";
import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { PromotionStatusBadge } from "./status-badges";
import { PageSplitLayout } from "@/routes/_backend/dashboard/-components/layout/page-split-layout";
import { MetadataCard } from "@/routes/_backend/dashboard/-components/metadata-card/metadata-card";

const PromotionDetail = () => {
  const { id } = useParams({ strict: false }) as { id: string };
  const navigate = useNavigate();
  const { data: result, isPending } = useQuery(promotionQueries.detail(id));
  const promotion = result?.success ? result.data : null;
  if (isPending) return <CollectionDetailSkeleton />;
  if (!promotion)
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4">
        <p className="text-sm text-muted-foreground">
          {result?.message ?? "Promotion not found"}
        </p>
        <Button variant="outline" size="sm" asChild>
          <Link to="/dashboard/$slug" params={{ slug: "promotions" }}>
            Back to promotions
          </Link>
        </Button>
      </div>
    );
  const methodValue =
    promotion.methodType === "percentage"
      ? `${promotion.value ?? 0}%`
      : `${promotion.value ?? 0} ${(promotion.currencyCode ?? "").toUpperCase()}`.trim();
  const fields: EditCardField[] = [
    {
      key: "type",
      label: "Type",
      displayValue: promotion.type === "buyget" ? "Buy X get Y" : "Standard",
    },
    {
      key: "method",
      label: "Method",
      displayValue:
        promotion.methodType === "fixed" ? "Fixed amount" : "Percentage",
    },
    { key: "value", label: "Value", displayValue: methodValue },
    {
      key: "target",
      label: "Target",
      displayValue: promotion.targetType?.replaceAll("_", " ") ?? "—",
    },
    {
      key: "allocation",
      label: "Allocation",
      displayValue: promotion.allocation ?? "—",
    },
    {
      key: "automatic",
      label: "Automatic",
      displayValue: promotion.isAutomatic ? "Yes" : "No",
    },
    {
      key: "tax",
      label: "Tax inclusive",
      displayValue: promotion.isTaxInclusive ? "Yes" : "No",
    },
    {
      key: "usage",
      label: "Usage",
      displayValue: promotion.limit
        ? `${promotion.used} of ${promotion.limit}`
        : `${promotion.used} (unlimited)`,
    },
  ];
  const allRules = [
    ...promotion.rules.map((rule) => ({ ...rule, scope: "Eligibility" })),
    ...promotion.targetRules.map((rule) => ({ ...rule, scope: "Target" })),
    ...promotion.buyRules.map((rule) => ({ ...rule, scope: "Buy" })),
  ];
  const sidebar = (
    <div className="flex min-w-0 flex-col gap-4">
      <EditCard
        id="promotion-campaign"
        title="Campaign"
        fields={
          promotion.campaign
            ? [
                {
                  key: "name",
                  label: "Name",
                  displayValue: promotion.campaign.name,
                },
                {
                  key: "identifier",
                  label: "Identifier",
                  displayValue: promotion.campaign.identifier,
                },
                {
                  key: "starts",
                  label: "Starts",
                  displayValue: promotion.campaign.startsAt
                    ? new Date(promotion.campaign.startsAt).toLocaleString()
                    : "—",
                },
                {
                  key: "ends",
                  label: "Ends",
                  displayValue: promotion.campaign.endsAt
                    ? new Date(promotion.campaign.endsAt).toLocaleString()
                    : "—",
                },
              ]
            : [
                {
                  key: "campaign",
                  label: "Campaign",
                  displayValue: "Not assigned",
                },
              ]
        }
      />
    </div>
  );
  return (
    <PageSplitLayout sidebar={sidebar}>
      <div className="flex min-w-0 flex-col gap-4">
        <EditCard
          id={`promotion-${id}`}
          title={promotion.code}
          description="Promotion details and application method."
          fields={fields}
          onEdit={() =>
            void navigate({
              to: "/dashboard/$slug/$id/edit",
              params: { slug: "promotions", id },
            })
          }
          headerActions={<PromotionStatusBadge status={promotion.status} />}
        />
        <CardWrapper
          label="Conditions"
          description="Eligibility, target, and buy rules"
        >
          {allRules.length === 0 ? (
            <div className="border-t px-6 py-5 text-sm text-muted-foreground">
              No conditions configured. This promotion applies to every matching{" "}
              {promotion.targetType?.replaceAll("_", " ") ?? "target"}.
            </div>
          ) : (
            <div className="divide-y border-t">
              {allRules.map((rule, index) => (
                <div
                  className="grid grid-cols-[7rem_minmax(0,1fr)] gap-4 px-6 py-4 text-sm"
                  key={`${rule.scope}-${rule.attribute}-${index}`}
                >
                  <span className="text-muted-foreground">{rule.scope}</span>
                  <span>
                    {rule.attribute} {rule.operator}{" "}
                    {rule.values.join(", ") || "—"}
                  </span>
                </div>
              ))}
            </div>
          )}
        </CardWrapper>
        <MetadataCard
          slug="promotions"
          id={id}
          keyCount={Object.keys(promotion.metadata).length}
        />
      </div>
    </PageSplitLayout>
  );
};
export default PromotionDetail;
