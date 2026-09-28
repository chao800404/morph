import { Button } from "@/components/ui/button";
import { findCollection } from "@/lib/config/navigation";
import { viewPreloader } from "@/lib/config/lazy-view";
import {
  EditCard,
  type EditCardField,
} from "@/routes/_backend/dashboard/-components/edit-card/edit-card";
import { MetadataCard } from "@/routes/_backend/dashboard/-components/metadata-card/metadata-card";
import { getConfig } from "@/server/get-config";
import { stockLocationQueries } from "@queries/stock-location.queries";
import { useSuspenseQuery } from "@tanstack/react-query";
import {
  Link,
  useNavigate,
  useParams,
  useRouter,
} from "@tanstack/react-router";
import { useCallback, useMemo } from "react";

export default function LocationDetail() {
  const { id } = useParams({ strict: false }) as { id: string };
  const navigate = useNavigate();
  const router = useRouter();
  const { data: result } = useSuspenseQuery(stockLocationQueries.detail(id));
  const location = result.success ? result.data : null;
  const editView = useMemo(
    () =>
      findCollection(getConfig().client.collections.settings, "locations")?.edit
        ?.view,
    [],
  );
  const openEdit = useCallback(
    () =>
      void navigate({
        to: "/dashboard/settings/$slug/$id/edit",
        params: { slug: "locations", id },
      }),
    [id, navigate],
  );
  const preloadEdit = useCallback(() => {
    void viewPreloader(editView)?.();
    void router.preloadRoute({
      to: "/dashboard/settings/$slug/$id/edit",
      params: { slug: "locations", id },
    });
  }, [editView, id, router]);

  if (!location) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 text-center">
        <p className="text-sm text-muted-foreground">{result.message}</p>
        <Button variant="outline" size="sm" asChild>
          <Link to="/dashboard/settings/$slug" params={{ slug: "locations" }}>
            Back to locations
          </Link>
        </Button>
      </div>
    );
  }

  const address = location.address;
  const fields: EditCardField[] = [
    { key: "company", label: "Company", value: address?.company ?? "" },
    {
      key: "address",
      label: "Address",
      value: address?.address1 ?? "",
      displayValue:
        [address?.address1, address?.address2].filter(Boolean).join(", ") ||
        "—",
    },
    { key: "city", label: "City", value: address?.city ?? "" },
    { key: "province", label: "Province", value: address?.province ?? "" },
    {
      key: "postalCode",
      label: "Postal code",
      value: address?.postalCode ?? "",
    },
    {
      key: "country",
      label: "Country code",
      value: address?.countryCode?.toUpperCase() ?? "",
    },
    { key: "phone", label: "Phone", value: address?.phone ?? "" },
  ];

  return (
    <div className="flex flex-col gap-4">
      <EditCard
        id="location-general"
        title={location.name}
        fields={fields}
        onEdit={openEdit}
        onEditPreload={preloadEdit}
      />
      <EditCard
        id="location-sales-channels"
        title="Sales channels"
        description="Sales channels that can fulfill orders from this location."
        fields={[
          {
            key: "salesChannels",
            label: "Assigned channels",
            value: location.salesChannels
              .map((channel) => channel.name)
              .join(", "),
            displayValue:
              location.salesChannels
                .map((channel) => channel.name)
                .join(", ") || "No sales channels assigned",
          },
        ]}
        headerActions={
          <Button variant="form" size="xs" asChild>
            <Link
              to="/dashboard/settings/$slug/$id/$page"
              params={{ slug: "locations", id, page: "sales-channels" }}
            >
              Manage
            </Link>
          </Button>
        }
      />
      <EditCard
        id="location-fulfillment-providers"
        title="Fulfillment providers"
        description="Providers available to process shipments from this location."
        fields={[
          {
            key: "fulfillmentProviders",
            label: "Assigned providers",
            value: location.fulfillmentProviders
              .map((provider) => provider.name)
              .join(", "),
            displayValue:
              location.fulfillmentProviders
                .map((provider) => provider.name)
                .join(", ") || "No fulfillment providers assigned",
          },
        ]}
        headerActions={
          <Button variant="form" size="xs" asChild>
            <Link
              to="/dashboard/settings/$slug/$id/$page"
              params={{ slug: "locations", id, page: "fulfillment-providers" }}
            >
              Manage
            </Link>
          </Button>
        }
      />
      <EditCard
        id="location-shipping-options"
        title="Shipping options"
        description="Geographic service zones, shipping profiles, and flat rates offered at checkout."
        fields={[
          {
            key: "shippingOptions",
            label: "Configuration",
            value: "Manage shipping options",
          },
        ]}
        headerActions={
          <Button variant="form" size="xs" asChild>
            <Link
              to="/dashboard/settings/$slug/$id/$page"
              params={{ slug: "locations", id, page: "shipping-options" }}
            >
              Manage
            </Link>
          </Button>
        }
      />
      <MetadataCard
        slug="locations"
        id={id}
        keyCount={Object.keys(location.metadata).length}
        scope="settings"
      />
    </div>
  );
}
