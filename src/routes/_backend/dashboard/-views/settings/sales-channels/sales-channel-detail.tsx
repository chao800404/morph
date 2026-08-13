import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { findCollection } from "@/lib/config/navigation";
import { viewPreloader } from "@/lib/config/lazy-view";
import {
  DataTableCard,
  useCollectionDetailPreload,
} from "@/routes/_backend/dashboard/-components/data-table-card";
import {
  EditCard,
  type EditCardField,
} from "@/routes/_backend/dashboard/-components/edit-card/edit-card";
import { MetadataCard } from "@/routes/_backend/dashboard/-components/metadata-card/metadata-card";
import { getConfig } from "@/server/get-config";
import {
  normalizeProductListParams,
  productQueries,
} from "@queries/product.queries";
import { salesChannelQueries } from "@queries/sales-channel.queries";
import { tableViewQueries } from "@queries/table-view.queries";
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
} from "@tanstack/react-router";
import { useCallback, useMemo } from "react";
import { PRODUCT_TABLE_COLUMNS } from "../../global/contents/products/config/product-table-columns";
import { PRODUCT_SORT_OPTIONS } from "../../global/contents/products/config/product-table.config";
import { useProductTableControls } from "../../global/contents/products/hooks/use-product-table-controls";
import { salesChannelTypeLabel } from "@/lib/sales-channel/types";

export default function SalesChannelDetail() {
  const { id } = useParams({ strict: false }) as { id: string };
  const { search, filters } = useProductTableControls();
  const navigate = useNavigate();
  const router = useRouter();
  const queryClient = useQueryClient();
  const preloadProduct = useCollectionDetailPreload("products");
  const { data: result } = useSuspenseQuery(salesChannelQueries.detail(id));
  const { data: tableViewResult } = useSuspenseQuery(
    tableViewQueries.detail("products"),
  );
  const initialColumnConfiguration =
    tableViewResult.success && tableViewResult.data
      ? {
          order: tableViewResult.data.columnOrder,
          hidden: tableViewResult.data.hiddenColumns,
        }
      : null;
  const productParams = {
    ...normalizeProductListParams(search),
    salesChannelId: id,
  };
  const { data: productResult, isPending: productsPending } = useQuery(
    productQueries.list(productParams),
  );
  const channel = result.success ? result.data : null;
  const editView = useMemo(
    () =>
      findCollection(getConfig().client.collections.settings, "sales-channels")
        ?.edit?.view,
    [],
  );
  const openEdit = useCallback(
    () =>
      void navigate({
        to: "/dashboard/settings/$slug/$id/edit",
        params: { slug: "sales-channels", id },
      }),
    [id, navigate],
  );
  const preloadEdit = useCallback(() => {
    void viewPreloader(editView)?.();
    void router.preloadRoute({
      to: "/dashboard/settings/$slug/$id/edit",
      params: { slug: "sales-channels", id },
    });
  }, [editView, id, router]);
  const retryProducts = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: productQueries.all() });
  }, [queryClient]);

  if (!channel) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 text-center">
        <p className="text-sm text-muted-foreground">
          {result.message ?? "Sales channel not found"}
        </p>
        <Button variant="outline" size="sm" asChild>
          <Link
            to="/dashboard/settings/$slug"
            params={{ slug: "sales-channels" }}
          >
            Back to sales channels
          </Link>
        </Button>
      </div>
    );
  }

  const fields: EditCardField[] = [
    {
      key: "type",
      label: "Type",
      value: channel.type,
      displayValue: salesChannelTypeLabel(channel.type),
    },
    {
      key: "status",
      label: "Status",
      value: channel.isDisabled ? "Disabled" : "Enabled",
      displayValue: (
        <StatusBadge color={channel.isDisabled ? "red" : "green"}>
          {channel.isDisabled ? "Disabled" : "Enabled"}
        </StatusBadge>
      ),
    },
    {
      key: "description",
      label: "Description",
      value: channel.description ?? "",
      displayValue: channel.description || "—",
    },
  ];
  const products = productResult?.success
    ? (productResult.data?.products ?? [])
    : [];

  return (
    <div className="flex flex-col gap-4">
      <EditCard
        id="sales-channel-general"
        title={channel.name}
        fields={fields}
        onEdit={openEdit}
        onEditPreload={preloadEdit}
      />

      <DataTableCard
        label="Products"
        description="Products available in this sales channel."
        headerActions={
          <Button variant="form" size="xs" asChild>
            <Link
              to="/dashboard/settings/$slug/$id/$page"
              params={{
                slug: "sales-channels",
                id,
                page: "add-products",
              }}
            >
              Add
            </Link>
          </Button>
        }
        searchPlaceholder="Search"
        columnConfigurationKey="products"
        initialColumnConfiguration={initialColumnConfiguration}
        filters={filters}
        sortOptions={PRODUCT_SORT_OPTIONS}
        columns={PRODUCT_TABLE_COLUMNS}
        rows={products}
        getRowId={(product) => product.id}
        isPending={productsPending}
        errorMessage={
          productResult && !productResult.success ? productResult.message : null
        }
        onRetry={retryProducts}
        emptyTitle="No products in this sales channel"
        emptyDescription="Assign this sales channel from a product's sales channel settings."
        onRowClick={(product) =>
          void navigate({
            to: "/dashboard/$slug/$id",
            params: { slug: "products", id: product.id },
          })
        }
        onRowPreload={(product) => preloadProduct(product.id)}
        pagination={
          productResult?.success && productResult.data
            ? productResult.data.pagination
            : undefined
        }
      />
      <MetadataCard
        slug="sales-channels"
        id={id}
        keyCount={Object.keys(channel.metadata).length}
        scope="settings"
      />
    </div>
  );
}
