import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { findCollection } from "@/lib/config/navigation";
import { viewPreloader } from "@/lib/config/lazy-view";
import {
  getCountryTaxSublevelType,
  getTaxSublevelLabel,
} from "@/lib/tax/country-sublevels";
import type { TaxRateDTO, TaxRegionSummaryDTO } from "@/lib/tax/dto/tax.dto";
import type { DashboardSearch } from "@/lib/validations/dashboard-search";
import {
  DataTableCard,
  deleteActionIcon,
  editActionIcon,
  useCollectionDetailPreload,
  type DataTableColumn,
  type DataTableFilterDefinition,
  type RowAction,
} from "@/routes/_backend/dashboard/-components/data-table-card";
import {
  EditCard,
  type EditCardField,
} from "@/routes/_backend/dashboard/-components/edit-card/edit-card";
import { MetadataCard } from "@/routes/_backend/dashboard/-components/metadata-card/metadata-card";
import { useInfoStore } from "@/routes/_backend/dashboard/-views/features/global-info/use-info-store";
import { getConfig } from "@/server/get-config";
import {
  normalizeTaxProvinceListParams,
  normalizeTaxRateListParams,
  taxQueries,
} from "@queries/tax.queries";
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
import { CircleAlert, Plus } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { deleteTaxRatesAction, deleteTaxRegionsAction } from "./tax-actions";
import { formatTaxProviderLabel } from "./config/tax-form-fields";

export default function TaxRegionDetail() {
  const [showSublevelRegions, setShowSublevelRegions] = useState(false);
  const [sublevelAlertDismissed, setSublevelAlertDismissed] = useState(false);
  const { id } = useParams({ strict: false }) as { id: string };
  const search = useSearch({ strict: false }) as DashboardSearch;
  const navigate = useNavigate();
  const router = useRouter();
  const client = useQueryClient();
  const preloadProvinceDetail = useCollectionDetailPreload(
    "tax-regions",
    "settings",
  );
  const result = useSuspenseQuery(taxQueries.detail(id)).data;
  const provinceQuery = useQuery(
    taxQueries.provinces(normalizeTaxProvinceListParams(id, search)),
  );
  const defaultRateQuery = useQuery(
    taxQueries.rates(normalizeTaxRateListParams(id, "default", search)),
  );
  const overrideRateQuery = useQuery(
    taxQueries.rates(normalizeTaxRateListParams(id, "override", search)),
  );
  const region = result.success ? result.data : null;
  const { setInfoData, setInfoOpen } = useInfoStore(
    useShallow((state) => ({
      setInfoData: state.setInfoData,
      setInfoOpen: state.setOpen,
    })),
  );
  const editView = useMemo(
    () =>
      findCollection(getConfig().client.collections.settings, "tax-regions")
        ?.edit?.view,
    [],
  );
  const rateEditViews = useMemo(() => {
    const pages = findCollection(
      getConfig().client.collections.settings,
      "tax-regions",
    )?.pages;
    return {
      default: pages?.["edit-default-rate"]?.view,
      override: pages?.["edit-override"]?.view,
    };
  }, []);
  const openEdit = useCallback(
    () =>
      void navigate({
        to: "/dashboard/settings/$slug/$id/edit",
        params: { slug: "tax-regions", id },
      }),
    [id, navigate],
  );
  const preloadEdit = useCallback(() => {
    void viewPreloader(editView)?.();
    void router.preloadRoute({
      to: "/dashboard/settings/$slug/$id/edit",
      params: { slug: "tax-regions", id },
    });
  }, [editView, id, router]);
  const preloadRateEdit = useCallback(
    (rate: TaxRateDTO) => {
      const page = rate.isDefault ? "edit-default-rate" : "edit-override";
      const view = rate.isDefault
        ? rateEditViews.default
        : rateEditViews.override;
      void viewPreloader(view)?.();
      void router.preloadRoute({
        to: "/dashboard/settings/$slug/$id/$page/$childId",
        params: {
          slug: "tax-regions",
          id,
          page,
          childId: rate.id,
        },
      });
    },
    [id, rateEditViews, router],
  );
  if (!region)
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        {result.message}
      </div>
    );
  const sublevelType = getCountryTaxSublevelType(region.countryCode);
  const hasSublevelRegions = Boolean(
    provinceQuery.data?.success && provinceQuery.data.data.pagination.total > 0,
  );
  const showSublevelAlert =
    !region.parentId &&
    !sublevelType &&
    !showSublevelRegions &&
    !sublevelAlertDismissed &&
    !hasSublevelRegions;
  const showSublevelTable =
    !region.parentId &&
    Boolean(sublevelType || showSublevelRegions || hasSublevelRegions);
  const sublevelLabel = getTaxSublevelLabel(sublevelType);
  const provinceResult = provinceQuery.data;
  const provinceRows = provinceResult?.success
    ? provinceResult.data.taxRegions
    : [];
  const defaultRateResult = defaultRateQuery.data;
  const defaultRateRows = defaultRateResult?.success
    ? defaultRateResult.data.taxRates
    : [];
  const overrideRateResult = overrideRateQuery.data;
  const overrideRateRows = overrideRateResult?.success
    ? overrideRateResult.data.taxRates
    : [];
  const provinceFilters: DataTableFilterDefinition[] = [
    {
      key: "tax-rates",
      label: "Tax rates",
      options: [
        { value: "yes", label: "Has tax rates" },
        { value: "no", label: "No tax rates" },
      ],
      values: search.taxRegionHasRates ? [search.taxRegionHasRates] : [],
      multiple: false,
      onValuesChange: (values) =>
        void navigate({
          to: ".",
          search: (previous: DashboardSearch) => ({
            ...previous,
            taxRegionHasRates: values.at(-1) as
              | DashboardSearch["taxRegionHasRates"]
              | undefined,
            page: undefined,
          }),
          replace: true,
        }),
    },
  ];
  const fields: EditCardField[] = [
    { key: "country", label: "Country", value: region.countryName },
    {
      key: "code",
      label: "Country code",
      value: region.countryCode.toUpperCase(),
    },
    ...(region.provinceCode
      ? [
          {
            key: "province",
            label: "Province / state code",
            value: region.provinceCode,
          },
        ]
      : []),
    {
      key: "provider",
      label: "Tax provider",
      value: region.parentId
        ? "Inherited from country region"
        : region.providerId
          ? formatTaxProviderLabel(region.providerId)
          : "—",
    },
  ];
  const provinceColumns: DataTableColumn<TaxRegionSummaryDTO>[] = [
    {
      key: "province",
      header: "Province / state",
      className: "font-medium",
      cell: (item) => item.provinceCode,
    },
    { key: "rates", header: "Tax rates", cell: (item) => item.taxRateCount },
  ];
  const rateColumns: DataTableColumn<TaxRateDTO>[] = [
    {
      key: "name",
      header: "Name",
      className: "font-medium",
      cell: (rate) => rate.name,
    },
    { key: "code", header: "Code", cell: (rate) => rate.code },
    {
      key: "rate",
      header: "Rate",
      cell: (rate) => (rate.rate === null ? "—" : `${rate.rate}%`),
    },
    {
      key: "default",
      header: "Behavior",
      cell: (rate) => (
        <Badge variant="secondary">
          {rate.isDefault
            ? "Default"
            : rate.isCombinable
              ? "Combinable"
              : "Override"}
        </Badge>
      ),
    },
    {
      key: "targets",
      header: "Targets",
      cell: (rate) =>
        rate.isDefault
          ? "All other taxable items"
          : rate.rules.length
            ? `${rate.rules
                .slice(0, 2)
                .map((rule) => rule.label)
                .join(
                  ", ",
                )}${rate.rules.length > 2 ? ` +${rate.rules.length - 2}` : ""}`
            : "—",
    },
  ];
  const confirmDelete = (
    kind: "region" | "rate",
    recordId: string,
    name: string,
  ) => {
    setInfoData({
      title: `Delete ${kind === "rate" ? "Tax Rate" : "Tax Region"}`,
      description: `Are you sure you want to delete “${name}”? This action cannot be undone.`,
      fields: [
        { type: "hidden", name: "ids", value: JSON.stringify([recordId]) },
      ],
      action: kind === "rate" ? deleteTaxRatesAction : deleteTaxRegionsAction,
      confirmLabel: "Delete",
      confirmVariant: "destructive",
      onSuccess: () =>
        void client.invalidateQueries({ queryKey: taxQueries.all() }),
    });
    setInfoOpen(true);
  };
  return (
    <div className="flex flex-col gap-4">
      {showSublevelAlert ? (
        <Alert
          role="note"
          aria-label="Sublevel region availability"
          className="border-border bg-card shadow-xs"
        >
          <CircleAlert className="fill-muted-foreground text-card" />
          <AlertTitle>Sublevel regions are disabled</AlertTitle>
          <AlertDescription>
            <p>
              This region disables sublevel regions by default. Enable them to
              create more specific regions such as provinces, states, or
              territories.
            </p>
            <div className="mt-2 flex items-center gap-2">
              <Button
                type="button"
                variant="cardHeader"
                size="xs"
                onClick={() => setShowSublevelRegions(true)}
              >
                Enable
              </Button>
              <Button
                type="button"
                variant="link"
                size="xs"
                onClick={() => setSublevelAlertDismissed(true)}
              >
                Hide
              </Button>
            </div>
          </AlertDescription>
        </Alert>
      ) : null}
      <EditCard
        id="tax-region-general"
        title={
          region.provinceCode
            ? `${region.countryName} — ${region.provinceCode}`
            : region.countryName
        }
        fields={fields}
        onEdit={region.parentId ? undefined : openEdit}
        onEditPreload={region.parentId ? undefined : preloadEdit}
      />
      {showSublevelTable ? (
        <DataTableCard
          label={sublevelLabel}
          description="Define more specific tax rules for provinces, states, or territories."
          headerActions={
            <Button variant="form" size="xs" asChild>
              <Link
                to="/dashboard/settings/$slug/$id/$page"
                params={{ slug: "tax-regions", id, page: "create-province" }}
              >
                <Plus />
                Create
              </Link>
            </Button>
          }
          columns={provinceColumns}
          rows={provinceRows}
          getRowId={(item) => item.id}
          isPending={provinceQuery.isPending}
          errorMessage={
            provinceResult && !provinceResult.success
              ? provinceResult.message
              : null
          }
          onRetry={() => void provinceQuery.refetch()}
          searchPlaceholder={`Search ${sublevelLabel.toLowerCase()}`}
          filters={provinceFilters}
          sortOptions={[
            { value: "code", label: "Code" },
            { value: "createdAt", label: "Created" },
            { value: "updatedAt", label: "Updated" },
          ]}
          defaultSortBy="code"
          pagination={
            provinceResult?.success ? provinceResult.data.pagination : undefined
          }
          emptyTitle="No province regions yet"
          emptyDescription="Create a sub-region when part of this country uses different tax rules."
          onRowClick={(item) =>
            void navigate({
              to: "/dashboard/settings/$slug/$id",
              params: { slug: "tax-regions", id: item.id },
            })
          }
          onRowPreload={(item) => preloadProvinceDetail(item.id)}
          rowActions={(item): RowAction[] => [
            {
              label: "Delete",
              icon: deleteActionIcon,
              destructive: true,
              onSelect: () =>
                confirmDelete(
                  "region",
                  item.id,
                  item.provinceCode ?? item.countryName,
                ),
            },
          ]}
        />
      ) : null}
      <DataTableCard
        label="Default Tax Rate"
        description="The fallback rate applied when no tax override matches."
        headerActions={
          defaultRateRows.length ? null : (
            <Button variant="form" size="xs" asChild>
              <Link
                to="/dashboard/settings/$slug/$id/$page"
                params={{ slug: "tax-regions", id, page: "create-rate" }}
              >
                <Plus />
                Create
              </Link>
            </Button>
          )
        }
        columns={rateColumns}
        rows={defaultRateRows}
        getRowId={(rate) => rate.id}
        isPending={defaultRateQuery.isPending}
        errorMessage={
          defaultRateResult && !defaultRateResult.success
            ? defaultRateResult.message
            : null
        }
        onRetry={() => void defaultRateQuery.refetch()}
        emptyTitle="No default tax rate yet"
        emptyDescription="Create the fallback rate for this tax region."
        rowActions={(rate): RowAction[] => [
          {
            label: "Edit",
            icon: editActionIcon,
            preload: () => preloadRateEdit(rate),
            onSelect: () =>
              void navigate({
                to: "/dashboard/settings/$slug/$id/$page/$childId",
                params: {
                  slug: "tax-regions",
                  id,
                  page: "edit-default-rate",
                  childId: rate.id,
                },
              }),
          },
          {
            label: "Delete",
            icon: deleteActionIcon,
            destructive: true,
            onSelect: () => confirmDelete("rate", rate.id, rate.name),
          },
        ]}
      />
      <DataTableCard
        label="Tax Overrides"
        description="Specific rates for products, product types, or shipping options."
        headerActions={
          <Button variant="form" size="xs" asChild>
            <Link
              to="/dashboard/settings/$slug/$id/$page"
              params={{ slug: "tax-regions", id, page: "create-override" }}
            >
              <Plus />
              Create
            </Link>
          </Button>
        }
        columns={rateColumns}
        rows={overrideRateRows}
        getRowId={(rate) => rate.id}
        isPending={overrideRateQuery.isPending}
        errorMessage={
          overrideRateResult && !overrideRateResult.success
            ? overrideRateResult.message
            : null
        }
        onRetry={() => void overrideRateQuery.refetch()}
        searchPlaceholder="Search tax overrides"
        sortOptions={[
          { value: "name", label: "Name" },
          { value: "createdAt", label: "Created" },
          { value: "updatedAt", label: "Updated" },
        ]}
        defaultSortBy="createdAt"
        searchScope="taxRate"
        pagination={
          overrideRateResult?.success
            ? overrideRateResult.data.pagination
            : undefined
        }
        emptyTitle="No tax overrides yet"
        emptyDescription="Add an override when selected items use a different tax rate."
        rowActions={(rate): RowAction[] => [
          {
            label: "Edit",
            icon: editActionIcon,
            preload: () => preloadRateEdit(rate),
            onSelect: () =>
              void navigate({
                to: "/dashboard/settings/$slug/$id/$page/$childId",
                params: {
                  slug: "tax-regions",
                  id,
                  page: "edit-override",
                  childId: rate.id,
                },
              }),
          },
          {
            label: "Delete",
            icon: deleteActionIcon,
            destructive: true,
            onSelect: () => confirmDelete("rate", rate.id, rate.name),
          },
        ]}
      />
      <MetadataCard
        slug="tax-regions"
        id={id}
        keyCount={Object.keys(region.metadata).length}
        scope="settings"
      />
    </div>
  );
}
