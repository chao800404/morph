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

const PRICE_HISTORY_PAGE_SIZE = 5;

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

  const product = productQuery.data?.success ? productQuery.data.data : null;
  const detail = variantQuery.data?.success ? variantQuery.data.data : null;
  const variant = detail?.variant ?? null;
  const priceHistory = detail?.priceHistory ?? [];
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
  const historySearch = search.q?.trim().toLowerCase() ?? "";
  const historySortBy = Array.isArray(search.sortBy)
    ? search.sortBy[0]
    : search.sortBy;
  const historySortOrder = Array.isArray(search.sortOrder)
    ? search.sortOrder[0]
    : search.sortOrder;
  const changeType = (entry: (typeof priceHistory)[number]) => {
    if (entry.oldAmount === null) return "created";
    if (entry.newAmount === null) return "removed";
    return entry.newAmount > entry.oldAmount ? "increased" : "decreased";
  };
  const changedAfter = historyChangedWithin
    ? Date.now() -
      ({ "24h": 1, "7d": 7, "30d": 30, "90d": 90 }[historyChangedWithin] *
        24 *
        60 *
        60 *
        1000)
    : undefined;
  const matchingPriceHistory = priceHistory
    .filter(
      (entry) =>
        historyCurrencies.length === 0 ||
        historyCurrencies.includes(entry.currencyCode),
    )
    .filter(
      (entry) =>
        historyChanges.length === 0 ||
        historyChanges.includes(changeType(entry)),
    )
    .filter(
      (entry) =>
        historyChangedBy.length === 0 ||
        historyChangedBy.includes(entry.changedBy),
    )
    .filter(
      (entry) =>
        changedAfter === undefined ||
        new Date(entry.changedAt).getTime() >= changedAfter,
    )
    .filter((entry) =>
      [entry.currencyCode, entry.changedByName ?? "Unknown user"].some(
        (value) => value.toLowerCase().includes(historySearch),
      ),
    )
    .sort((left, right) => {
      const direction = historySortOrder === "asc" ? 1 : -1;
      if (historySortBy === "code") {
        return left.currencyCode.localeCompare(right.currencyCode) * direction;
      }
      if (historySortBy === "name") {
        return (
          (left.changedByName ?? "").localeCompare(right.changedByName ?? "") *
          direction
        );
      }
      return (
        (new Date(left.changedAt).getTime() -
          new Date(right.changedAt).getTime()) *
        direction
      );
    });
  const historyTotalPages = Math.max(
    1,
    Math.ceil(matchingPriceHistory.length / PRICE_HISTORY_PAGE_SIZE),
  );
  const historyPage = Math.min(
    Math.max(search.page ?? 1, 1),
    historyTotalPages,
  );
  const historyRows = matchingPriceHistory.slice(
    (historyPage - 1) * PRICE_HISTORY_PAGE_SIZE,
    historyPage * PRICE_HISTORY_PAGE_SIZE,
  );
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
      options: Array.from(
        new Set(priceHistory.map((entry) => entry.currencyCode)),
      )
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
          priceHistory.map((entry) => [
            entry.changedBy,
            entry.changedByName ?? "Unknown user",
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
            rows={historyRows}
            getRowId={(entry) => entry.id}
            filters={historyFilters}
            searchPlaceholder="Search price history"
            sortOptions={historySortOptions}
            defaultSortBy="updatedAt"
            emptyTitle="No price changes yet"
            emptyDescription="New base-price changes are recorded automatically."
            pagination={{
              page: historyPage,
              limit: PRICE_HISTORY_PAGE_SIZE,
              total: matchingPriceHistory.length,
              totalPages: historyTotalPages,
            }}
          />
        </div>
      </div>
    </PageSplitLayout>
  );
};

export default ProductVariantDetail;
