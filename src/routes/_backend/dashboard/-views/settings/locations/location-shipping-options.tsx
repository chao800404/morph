import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { CardWrapper } from "@/routes/_backend/dashboard/-components/card-wrapper";
import { RouteSurfaceMessage } from "@/components/dialog/route-surface-message";
import { RouteSurfacePending } from "@/components/dialog/route-surface-pending";
import {
  RouteFormPage,
  useRouteModalClose,
  type RouteFormState,
} from "@/components/dialog/route-form-modal";
import { findCountry, getCountryCatalog } from "@/lib/region/countries";
import { formatMoney, toMajorUnits } from "@/lib/currency/catalog";
import type { GeoZoneFormValue } from "@/lib/validations/form";
import {
  normalizeShippingProfileListParams,
  shippingProfileQueries,
} from "@queries/shipping-profile.queries";
import { shippingAdminQueries } from "@queries/shipping-admin.queries";
import {
  useQuery,
  useSuspenseQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { Link, useParams } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import {
  createLocationShippingOptionAction,
  deleteLocationShippingOptionAction,
  updateLocationShippingOptionAction,
} from "./location-shipping-option-actions";
import { locationShippingOptionFormFields } from "./location-shipping-option-form-fields";
import { LocationShippingOptionCreateForm } from "./location-shipping-option-form";

const postalExpressionToInput = (value: unknown): string => {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    return value
      .filter((item): item is string => typeof item === "string")
      .join("\n");
  }
  if (value && typeof value === "object") {
    const expression = value as Record<string, unknown>;
    if (typeof expression.pattern === "string") return expression.pattern;
    if (
      typeof expression.from === "string" &&
      typeof expression.to === "string"
    ) {
      return `${expression.from}..${expression.to}`;
    }
  }
  return "";
};

const describeGeoZone = (zone: {
  type: string;
  countryCode: string;
  provinceCode: string | null;
  city: string | null;
  postalExpression: unknown;
}) => {
  const country =
    findCountry(zone.countryCode)?.name ?? zone.countryCode.toUpperCase();
  const place = [zone.city, zone.provinceCode].filter(Boolean).join(", ");
  if (zone.type === "zip") {
    const postal = postalExpressionToInput(zone.postalExpression).replaceAll(
      "\n",
      ", ",
    );
    return `${postal} · ${place} · ${country}`;
  }
  return place ? `${place} · ${country}` : country;
};

export default function LocationShippingOptions() {
  const { id, childId } = useParams({ strict: false }) as {
    id: string;
    childId?: string;
  };
  const close = useRouteModalClose();
  const queryClient = useQueryClient();
  const [deleting, setDeleting] = useState<{
    id: string;
    name: string;
    updatedAt: string;
  } | null>(null);
  const { data: result } = useSuspenseQuery(
    shippingAdminQueries.forLocation(id),
  );
  const { data: profilesResult, isPending: profilesPending } = useQuery(
    shippingProfileQueries.list(
      normalizeShippingProfileListParams({
        sortBy: "name",
        sortOrder: "asc",
        page: 1,
        limit: 100,
      }),
    ),
  );

  if (!result.success) {
    return <RouteSurfaceMessage>{result.message}</RouteSurfaceMessage>;
  }

  const { zones, currencies, shippingOptionTypes } = result.data;
  if (childId) {
    const zone =
      zones.find((candidate) => candidate.id === childId) ??
      zones.find((candidate) =>
        candidate.options.some((option) => option.id === childId),
      );
    const option = zone?.options.find((candidate) => candidate.id === childId);
    if (!zone) {
      return (
        <RouteSurfaceMessage>Shipping option not found</RouteSurfaceMessage>
      );
    }
    if (profilesPending) return <RouteSurfacePending />;
    if (!profilesResult?.success) {
      return (
        <RouteSurfaceMessage>
          {profilesResult?.message ?? "Shipping profiles could not be loaded"}
        </RouteSurfaceMessage>
      );
    }

    if (!option) {
      const submit = async (
        _state: RouteFormState,
        formData: FormData,
      ): Promise<RouteFormState> => {
        formData.set("locationId", id);
        const response = await createLocationShippingOptionAction(formData);
        if (!response.success) return response;
        await queryClient.invalidateQueries({
          queryKey: shippingAdminQueries.all(),
        });
        toast.success(response.message);
        close();
        return response;
      };

      return (
        <LocationShippingOptionCreateForm
          title="Add shipping option"
          description={`${zone.name} · ${zone.geoZones
            .map(describeGeoZone)
            .join("; ")}`}
          action={submit}
          submitLabel="Create shipping option"
          loadingLabel="Creating..."
          serviceZoneId={zone.id}
          currencies={currencies}
          countries={getCountryCatalog().map((country) => ({
            id: country.iso2,
            value: country.name,
          }))}
          profiles={profilesResult.data.profiles.map((profile) => ({
            id: profile.id,
            value: profile.name,
          }))}
          optionTypes={shippingOptionTypes.map((type) => ({
            id: type.id,
            value: `${type.label} (${type.code})`,
          }))}
          fulfillmentProviders={result.data.fulfillmentProviders.map(
            (provider) => ({ id: provider.id, value: provider.name }),
          )}
          shippingRateProviders={result.data.shippingRateProviders.map(
            (provider) => ({ id: provider.id, value: provider.name }),
          )}
        />
      );
    }

    const currentRates = new Map(
      option.prices.map((price) => [price.currencyCode, price.amount]),
    );
    const submit = async (
      _state: RouteFormState,
      formData: FormData,
    ): Promise<RouteFormState> => {
      formData.set("locationId", id);
      formData.set("optionId", option.id);
      formData.set("expectedOptionUpdatedAt", option.updatedAt);
      formData.set("expectedZoneUpdatedAt", zone.updatedAt);
      const response = await updateLocationShippingOptionAction(formData);
      if (!response.success) return response;
      await queryClient.invalidateQueries({
        queryKey: shippingAdminQueries.all(),
      });
      await queryClient.invalidateQueries({
        queryKey: shippingProfileQueries.all(),
      });
      toast.success(response.message);
      close();
      return response;
    };

    return (
      <RouteFormPage
        title="Edit shipping option"
        description={option.name}
        action={submit}
        submitLabel="Save"
        loadingLabel="Saving..."
        fields={locationShippingOptionFormFields({
          currencies,
          countries: getCountryCatalog().map((country) => ({
            id: country.iso2,
            value: country.name,
          })),
          profiles: profilesResult.data.profiles.map((profile) => ({
            id: profile.id,
            value: profile.name,
          })),
          optionTypes: shippingOptionTypes.map((type) => ({
            id: type.id,
            value: `${type.label} (${type.code})`,
          })),
          current: {
            zoneName: zone.name,
            geoZones: zone.geoZones.map((geoZone): GeoZoneFormValue => ({
              type: geoZone.type,
              countryCode: geoZone.countryCode,
              ...(geoZone.provinceCode
                ? { provinceCode: geoZone.provinceCode }
                : {}),
              ...(geoZone.city ? { city: geoZone.city } : {}),
              ...(geoZone.type === "zip"
                ? {
                    postalExpression: postalExpressionToInput(
                      geoZone.postalExpression,
                    ),
                  }
                : {}),
            })),
            optionName: option.name,
            shippingProfileId: option.shippingProfileId ?? "",
            shippingOptionTypeId: option.shippingOptionTypeId,
            providerId: option.providerId,
            priceType: option.priceType,
            providerData: option.providerData,
            rules: JSON.stringify(option.rules),
            rates: Object.fromEntries(
              currencies.map((currency) => {
                const minorAmount = currentRates.get(
                  currency.code.toLowerCase(),
                );
                return [
                  `rate_${currency.code.toLowerCase()}`,
                  minorAmount === undefined
                    ? ""
                    : String(toMajorUnits(minorAmount, currency)),
                ];
              }),
            ),
          },
        })}
      />
    );
  }

  const currencyByCode = new Map(
    currencies.map((currency) => [currency.code.toLowerCase(), currency]),
  );
  const deactivate = async () => {
    if (!deleting) return;
    const response = await deleteLocationShippingOptionAction({
      locationId: id,
      optionId: deleting.id,
      expectedOptionUpdatedAt: deleting.updatedAt,
    });
    if (!response.success) {
      toast.error(response.message);
      setDeleting(null);
      return;
    }
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: shippingAdminQueries.all(),
      }),
      queryClient.invalidateQueries({
        queryKey: shippingProfileQueries.all(),
      }),
    ]);
    toast.success(response.message);
    setDeleting(null);
  };

  return (
    <div className="flex flex-col gap-4">
      <CardWrapper
        id="location-shipping-options"
        label="Shipping options"
        description="Service zones, fixed prices, and calculated rates available at checkout."
        headerButton={
          <Button variant="form" size="xs" asChild>
            <Link
              to="/dashboard/settings/$slug/$id/$page"
              params={{
                slug: "locations",
                id,
                page: "shipping-option-create",
              }}
            >
              Add service zone
            </Link>
          </Button>
        }
      >
        {zones.length ? (
          <div className="flex flex-col divide-y">
            {zones.map((zone) => (
              <section key={zone.id} className="space-y-3 py-4 first:pt-0">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-medium">{zone.name}</h3>
                    <p className="text-xs text-muted-foreground">
                      {zone.geoZones.map(describeGeoZone).join("; ") ||
                        "No geographic areas configured"}
                    </p>
                  </div>
                  <Button variant="outline" size="xs" asChild>
                    <Link
                      to="/dashboard/settings/$slug/$id/$page/$childId"
                      params={{
                        slug: "locations",
                        id,
                        page: "shipping-options",
                        childId: zone.id,
                      }}
                    >
                      Add option
                    </Link>
                  </Button>
                </div>
                {zone.options.length ? (
                  <div className="space-y-2">
                    {zone.options.map((option) => (
                      <div
                        key={option.id}
                        className="flex flex-col gap-2 rounded-md border bg-muted/20 px-3 py-2 md:flex-row md:items-center md:justify-between"
                      >
                        <div>
                          <p className="text-sm font-medium">{option.name}</p>
                          <p className="text-xs text-muted-foreground">
                            {option.priceType === "calculated"
                              ? "Calculated rate"
                              : "Fixed rate"}
                            {" · "}
                            {option.shippingProfileName ?? "No shipping profile"}
                            {" · "}
                            {option.shippingOptionTypeLabel ?? "No option type"}
                            {" · "}
                            {option.rules.length
                              ? `${option.rules.length} availability ${option.rules.length === 1 ? "rule" : "rules"}`
                              : "No availability rules"}
                          </p>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {option.priceType === "calculated" ? (
                            <span className="rounded-full bg-background px-2 py-1 text-xs">
                              Calculated at checkout
                            </span>
                          ) : option.prices.map((price) => {
                            const currency = currencyByCode.get(
                              price.currencyCode,
                            );
                            return (
                              <span
                                key={price.currencyCode}
                                className="rounded-full bg-background px-2 py-1 text-xs"
                              >
                                {currency
                                  ? formatMoney(price.amount, currency)
                                  : `${price.amount} ${price.currencyCode.toUpperCase()}`}
                              </span>
                            );
                          })}
                        </div>
                        <Button variant="outline" size="xs" asChild>
                          <Link
                            to="/dashboard/settings/$slug/$id/$page/$childId"
                            params={{
                              slug: "locations",
                              id,
                              page: "shipping-options",
                              childId: option.id,
                            }}
                          >
                            Edit
                          </Link>
                        </Button>
                        <Button
                          variant="destructive"
                          size="xs"
                          onClick={() =>
                            setDeleting({
                              id: option.id,
                              name: option.name,
                              updatedAt: option.updatedAt,
                            })
                          }
                        >
                          Deactivate
                        </Button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    No shipping options in this service zone.
                  </p>
                )}
              </section>
            ))}
          </div>
        ) : (
          <div className="py-8 text-center">
            <p className="text-sm font-medium">
              No shipping options configured
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              Add a service zone and fixed or calculated shipping option to
              make shipping available at checkout.
            </p>
          </div>
        )}
      </CardWrapper>
      <AlertDialog
        open={Boolean(deleting)}
        onOpenChange={(open) => !open && setDeleting(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Deactivate shipping option?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleting?.name} will no longer appear for new checkouts. Orders
              already placed keep their shipping details.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={(event) => {
                event.preventDefault();
                void deactivate();
              }}
            >
              Deactivate
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
