import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { findCollection } from "@/lib/config/navigation";
import { viewPreloader } from "@/lib/config/lazy-view";
import {
  EditCard,
  type EditCardField,
} from "@/routes/_backend/dashboard/-components/edit-card/edit-card";
import { MetadataCard } from "@/routes/_backend/dashboard/-components/metadata-card/metadata-card";
import { getConfig } from "@/server/get-config";
import { regionQueries } from "@queries/region.queries";
import { useSuspenseQuery } from "@tanstack/react-query";
import {
  Link,
  useNavigate,
  useParams,
  useRouter,
} from "@tanstack/react-router";
import { useCallback, useMemo } from "react";

export default function RegionDetail() {
  const { id } = useParams({ strict: false }) as { id: string };
  const navigate = useNavigate();
  const router = useRouter();
  const { data: result } = useSuspenseQuery(regionQueries.detail(id));
  const region = result.success ? result.data : null;
  const editView = useMemo(
    () =>
      findCollection(getConfig().client.collections.settings, "regions")?.edit
        ?.view,
    [],
  );
  const openEdit = useCallback(
    () =>
      void navigate({
        to: "/dashboard/settings/$slug/$id/edit",
        params: { slug: "regions", id },
      }),
    [id, navigate],
  );
  const preloadEdit = useCallback(() => {
    void viewPreloader(editView)?.();
    void router.preloadRoute({
      to: "/dashboard/settings/$slug/$id/edit",
      params: { slug: "regions", id },
    });
  }, [editView, id, router]);

  if (!region) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 text-center">
        <p className="text-sm text-muted-foreground">{result.message}</p>
        <Button variant="outline" size="sm" asChild>
          <Link to="/dashboard/settings/$slug" params={{ slug: "regions" }}>
            Back to regions
          </Link>
        </Button>
      </div>
    );
  }

  const fields: EditCardField[] = [
    {
      key: "currency",
      label: "Currency",
      value: region.currencyCode.toUpperCase(),
    },
    {
      key: "automaticTaxes",
      label: "Automatic taxes",
      value: region.automaticTaxes ? "Enabled" : "Disabled",
      displayValue: (
        <StatusBadge color={region.automaticTaxes ? "green" : "grey"}>
          {region.automaticTaxes ? "Enabled" : "Disabled"}
        </StatusBadge>
      ),
    },
    {
      key: "taxInclusive",
      label: "Tax-inclusive pricing",
      value: region.isTaxInclusive ? "Enabled" : "Disabled",
      displayValue: (
        <StatusBadge color={region.isTaxInclusive ? "green" : "grey"}>
          {region.isTaxInclusive ? "Enabled" : "Disabled"}
        </StatusBadge>
      ),
    },
    {
      key: "countries",
      label: "Countries",
      value: region.countries.map((country) => country.displayName).join(", "),
      displayValue:
        region.countries.map((country) => country.displayName).join(", ") ||
        "—",
    },
    {
      key: "paymentProviders",
      label: "Payment providers",
      value: region.paymentProviderIds.join(", "),
      displayValue: region.paymentProviderIds.join(", ") || "—",
    },
  ];

  return (
    <div className="flex flex-col gap-4">
      <EditCard
        id="region-general"
        title={region.name}
        fields={fields}
        onEdit={openEdit}
        onEditPreload={preloadEdit}
      />
      <MetadataCard
        slug="regions"
        id={id}
        keyCount={Object.keys(region.metadata).length}
        scope="settings"
      />
    </div>
  );
}
