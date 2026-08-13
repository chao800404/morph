import { AssetGrid } from "@/components/asset/asset-grid";
import { AssetTile } from "@/components/asset/asset-tile";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { findCurrency, formatMoney } from "@/lib/currency/catalog";
import type { DashboardSearch } from "@/lib/validations/dashboard-search";
import { CardWrapper } from "@/routes/_backend/dashboard/-components/card-wrapper";
import {
  DataTableCard,
  type DataTableColumn,
} from "@/routes/_backend/dashboard/-components/data-table-card/data-table-card";
import type { DataTableFilterDefinition } from "@/routes/_backend/dashboard/-components/data-table-card/data-table-filters";
import type { DataTableSortOption } from "@/routes/_backend/dashboard/-components/data-table-card/data-table-sort";
import {
  EditCard,
  type EditCardField,
} from "@/routes/_backend/dashboard/-components/edit-card/edit-card";
import { EditCardHeader } from "@/routes/_backend/dashboard/-components/edit-card/edit-card-header";
import { PageSplitLayout } from "@/routes/_backend/dashboard/-components/layout/page-split-layout";
import { MetadataCard } from "@/routes/_backend/dashboard/-components/metadata-card/metadata-card";
import { ProductVariantDetailSkeleton } from "./product-variant-detail-skeleton";
import {
  normalizeVariantPriceHistoryListParams,
  productQueries,
  productVariantQueries,
} from "@queries/product.queries";
import { useQuery } from "@tanstack/react-query";
import {
  Link,
  useNavigate,
  useParams,
  useSearch,
} from "@tanstack/react-router";

const ProductVariantDetail = () => {
  const { id: productId, childId } = useParams({ strict: false }) as {
    id: string;
    childId?: string;
  };
  const search = useSearch({ strict: false }) as DashboardSearch;
  const variantId = childId ?? search.variantId;
  const navigate = useNavigate();
  const productQuery = useQuery(productQueries.detail(productId));
  const variantQuery = useQuery({
    ...productVariantQueries.detail(
      variantId ?? "00000000-0000-0000-0000-000000000000",
    ),
    enabled: Boolean(variantId),
  });
  const historyQuery = useQuery({
    ...productVariantQueries.priceHistory(
      normalizeVariantPriceHistoryListParams(
        variantId ?? "00000000-0000-0000-0000-000000000000",
        search,
      ),
    ),
    enabled: Boolean(variantId),
  });

  const product = productQuery.data?.success ? productQuery.data.data : null;
  const detail = variantQuery.data?.success ? variantQuery.data.data : null;
  const variant = detail?.variant ?? null;
  const historyResult = historyQuery.data?.success
    ? historyQuery.data.data
    : null;
  const priceHistory = historyResult?.history ?? [];
  const historyCurrencies = search.priceHistoryCurrencies ?? [];
  const historyChanges = search.priceHistoryChanges ?? [];
  const historyChangedBy = search.priceHistoryChangedBy ?? [];
  const historyChangedWithin = search.priceHistoryChangedWithin;
  if (productQuery.isPending || (variantId && variantQuery.isPending)) {
    return <ProductVariantDetailSkeleton />;
  }

  if (!variantId || !product || !variant) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 text-center">
        <p className="text-sm text-muted-foreground">
          {variantQuery.data?.message ?? "Variant not found"}
        </p>
        <Button variant="outline" size="sm" asChild>
          <Link
            to="/dashboard/$slug/$id"
            params={{ slug: "products", id: productId }}
          >
            Back to product
          </Link>
        </Button>
      </div>
    );
  }

  const returnTo = `/dashboard/products/${productId}/variant/${variantId}`;
  const openEdit = (editSection: "general" | "media" | "inventory") =>
    void navigate({
      to: "/dashboard/$slug/$id/$page",
      params: { slug: "products", id: productId, page: "variant-edit" },
      search: { variantId, returnTo, editSection },
    });
  const openPricing = () =>
    void navigate({
      to: "/dashboard/$slug/$id/$page/$childId",
      params: {
        slug: "products",
        id: productId,
        page: "variant-pricing",
        childId: variantId,
      },
      search: { returnTo },
    });

  const optionFields: EditCardField[] = product.options.map((option) => {
    const selected = option.values.find((value) =>
      variant.optionValueIds.includes(value.id),
    );
    return {
      key: `option-${option.id}`,
      label: option.title,
      displayValue: selected ? (
        <Badge variant="secondary">{selected.value}</Badge>
      ) : (
        "—"
      ),
    };
  });
  const generalFields: EditCardField[] = [
    { key: "sku", label: "SKU", displayValue: variant.sku || "—" },
    { key: "barcode", label: "Barcode", displayValue: variant.barcode || "—" },
    ...optionFields,
  ];
  const inventoryFields: EditCardField[] = [
    {
      key: "managed",
      label: "Managed inventory",
      displayValue: variant.manageInventory ? "Yes" : "No",
    },
    {
      key: "backorder",
      label: "Allow backorder",
      displayValue: variant.allowBackorder ? "Yes" : "No",
    },
    {
      key: "quantity",
      label: "Quantity",
      displayValue: String(variant.inventoryQuantity),
    },
  ];
  const money = (currencyCode: string, amount: number | null) => {
    if (amount === null) return "Not set";
    const currency = findCurrency(currencyCode);
    return currency ? formatMoney(amount, currency) : String(amount);
  };
  const pricingFields: EditCardField[] =
    variant.prices.length > 0
      ? variant.prices.map((price) => ({
          key: `price-${price.currencyCode}`,
          label: price.currencyCode.toUpperCase(),
          displayValue: money(price.currencyCode, price.amount),
        }))
      : [
          {
            key: "base-prices",
            label: "Base prices",
            displayValue: "Not configured",
          },
        ];
  const historyColumns: DataTableColumn<(typeof priceHistory)[number]>[] = [
    {
      key: "currency",
      header: "Currency",
      className: "w-[9rem]",
      cell: (entry) => entry.currencyCode.toUpperCase(),
    },
    {
      key: "previousPrice",
      header: "Previous price",
      className: "whitespace-nowrap",
      cell: (entry) => money(entry.currencyCode, entry.oldAmount),
    },
    {
      key: "newPrice",
      header: "New price",
      className: "whitespace-nowrap font-medium",
      cell: (entry) => money(entry.currencyCode, entry.newAmount),
    },
    {
      key: "changedBy",
      header: "Changed by",
      className: "whitespace-nowrap",
      cell: (entry) => entry.changedByName ?? "Unknown user",
    },
    {
      key: "changedAt",
      header: "Changed at",
      className: "whitespace-nowrap",
      cell: (entry) => new Date(entry.changedAt).toLocaleString(),
    },
  ];
  const historySortOptions: DataTableSortOption[] = [
    { label: "Changed at", value: "updatedAt" },
    { label: "Currency", value: "code" },
    { label: "Changed by", value: "name" },
  ];
  const historyFilters: DataTableFilterDefinition[] = [
    {
      key: "currency",
      label: "Currency",
      options: Array.from(historyResult?.facets.currencies ?? [])
        .sort()
        .map((currencyCode) => ({
          value: currencyCode,
          label: currencyCode.toUpperCase(),
        })),
      values: historyCurrencies,
      onValuesChange: (values) => {
        void navigate({
          to: ".",
          search: (previous: DashboardSearch) => ({
            ...previous,
            priceHistoryCurrencies: values.length > 0 ? values : undefined,
            page: undefined,
          }),
          replace: true,
        });
      },
    },
    {
      key: "change",
      label: "Change",
      options: [
        { value: "created", label: "Price added" },
        { value: "increased", label: "Increased" },
        { value: "decreased", label: "Decreased" },
        { value: "removed", label: "Price removed" },
      ],
      values: historyChanges,
      onValuesChange: (values) => {
        void navigate({
          to: ".",
          search: (previous: DashboardSearch) => ({
            ...previous,
            priceHistoryChanges:
              values.length > 0
                ? (values as DashboardSearch["priceHistoryChanges"])
                : undefined,
            page: undefined,
          }),
          replace: true,
        });
      },
    },
    {
      key: "changedBy",
      label: "Changed by",
      options: Array.from(
        new Map(
          (historyResult?.facets.changedBy ?? []).map((entry) => [
            entry.id,
            entry.name,
          ]),
        ),
      )
        .sort((left, right) => left[1].localeCompare(right[1]))
        .map(([value, label]) => ({ value, label })),
      values: historyChangedBy,
      onValuesChange: (values) => {
        void navigate({
          to: ".",
          search: (previous: DashboardSearch) => ({
            ...previous,
            priceHistoryChangedBy: values.length > 0 ? values : undefined,
            page: undefined,
          }),
          replace: true,
        });
      },
    },
    {
      key: "changedAt",
      label: "Changed at",
      options: [
        { value: "24h", label: "Last 24 hours" },
        { value: "7d", label: "Last 7 days" },
        { value: "30d", label: "Last 30 days" },
        { value: "90d", label: "Last 90 days" },
      ],
      values: historyChangedWithin ? [historyChangedWithin] : [],
      multiple: false,
      onValuesChange: (values) => {
        void navigate({
          to: ".",
          search: (previous: DashboardSearch) => ({
            ...previous,
            priceHistoryChangedWithin:
              (values.at(-1) as DashboardSearch["priceHistoryChangedWithin"]) ??
              undefined,
            page: undefined,
          }),
          replace: true,
        });
      },
    },
  ];
  return (
    <PageSplitLayout
      sidebar={
        <div className="flex min-w-0 flex-col gap-4">
          <EditCard
            id="variant-inventory"
            title="Inventory"
            fields={inventoryFields}
            onEdit={() => openEdit("inventory")}
          />
          <MetadataCard
            slug="products"
            id={productId}
            page="variant-metadata"
            childId={variantId}
            keyCount={Object.keys(variant.metadata).length}
            returnTo={returnTo}
          />
        </div>
      }
    >
      <div className="flex min-w-0 flex-col gap-4">
        <EditCard
          id="variant-general"
          title={variant.title}
          description={`${product.title} variant`}
          fields={generalFields}
          onEdit={() => openEdit("general")}
        />

        <CardWrapper
          id="variant-media"
          label="Media"
          description="Variant-specific product media."
          headerButton={
            <EditCardHeader
              onClickEdit={() => openEdit("media")}
              label="Media actions"
            />
          }
        >
          {variant.assets.length === 0 ? (
            <div className="border-t px-6 py-5 text-sm text-muted-foreground">
              No variant media selected. Product media is used as the fallback.
            </div>
          ) : (
            <AssetGrid leadTile className="border-t p-6">
              {variant.assets.map((asset) => (
                <AssetTile key={asset.id} asset={asset} />
              ))}
            </AssetGrid>
          )}
        </CardWrapper>

        <EditCard
          id="variant-pricing"
          title="Pricing"
          description="Current base prices by store currency."
          fields={pricingFields}
          onEdit={openPricing}
        />

        <CardWrapper
          id="variant-price-lists"
          label="Price lists"
          description="Scheduled, customer-specific, and quantity-based pricing."
        >
          <div className="border-t px-6 py-5 text-sm text-muted-foreground">
            No price lists are linked to this variant.
          </div>
        </CardWrapper>

        <div id="variant-price-history">
          <DataTableCard
            label="Price history"
            description="Recent base-price changes by currency."
            columns={historyColumns}
            rows={priceHistory}
            getRowId={(entry) => entry.id}
            filters={historyFilters}
            searchPlaceholder="Search price history"
            sortOptions={historySortOptions}
            defaultSortBy="updatedAt"
            isPending={historyQuery.isPending}
            errorMessage={
              historyQuery.isError
                ? "Failed to load price history"
                : historyQuery.data && !historyQuery.data.success
                  ? historyQuery.data.message
                  : undefined
            }
            onRetry={() => void historyQuery.refetch()}
            emptyTitle="No price changes yet"
            emptyDescription="New base-price changes are recorded automatically."
            pagination={historyResult?.pagination}
          />
        </div>
      </div>
    </PageSplitLayout>
  );
};

export default ProductVariantDetail;
