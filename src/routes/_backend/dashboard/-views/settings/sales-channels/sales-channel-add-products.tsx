import { DialogFooterActions } from "@/components/dialog/dialog-footer-actions";
import { RouteFullscreenSurface } from "@/components/dialog/route-fullscreen-surface";
import { useRouteModalClose } from "@/components/dialog/route-form-modal";
import { DataTableCard } from "@/routes/_backend/dashboard/-components/data-table-card";
import { addProductsToSalesChannel } from "@/server/sales-channel/sales-channels.serverFn";
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
import { useParams } from "@tanstack/react-router";
import { useCallback, useState } from "react";
import { toast } from "sonner";
import { PRODUCT_TABLE_COLUMNS } from "../../global/contents/products/config/product-table-columns";
import { PRODUCT_SORT_OPTIONS } from "../../global/contents/products/config/product-table.config";
import { useProductTableControls } from "../../global/contents/products/hooks/use-product-table-controls";

export default function SalesChannelAddProducts() {
  const { id } = useParams({ strict: false }) as { id: string };
  const { search, filters } = useProductTableControls();
  const close = useRouteModalClose();
  const queryClient = useQueryClient();
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [pending, setPending] = useState(false);
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
  const params = {
    ...normalizeProductListParams(search),
    // Medusa's selector uses a larger fill-table page and keeps already-added
    // products visible as checked, disabled rows.
    limit: Number(search.limit) || 50,
  };
  const productQuery = useQuery(productQueries.list(params));
  const result = productQuery.data;
  const rows = result?.success ? (result.data?.products ?? []) : [];

  const retry = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: productQueries.all() });
  }, [queryClient]);

  const submit = async () => {
    if (selectedIds.size === 0) return;
    setPending(true);
    try {
      const response = await addProductsToSalesChannel({
        data: { salesChannelId: id, productIds: [...selectedIds] },
      });
      if (!response.success) {
        toast.error(response.message);
        return;
      }
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: productQueries.all() }),
        queryClient.invalidateQueries({ queryKey: salesChannelQueries.all() }),
      ]);
      toast.success(response.message);
      close();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to add products",
      );
    } finally {
      setPending(false);
    }
  };

  return (
    <RouteFullscreenSurface
      onClose={close}
      bodyClassName="overflow-hidden p-0"
      footer={
        <DialogFooterActions
          isSheet={false}
          isLoading={pending}
          isDisabled={selectedIds.size === 0}
          onCancel={close}
          onSubmit={() => void submit()}
          submitLabel="Save"
          loadingLabel="Saving..."
        />
      }
    >
      <DataTableCard
        label="Products"
        hideHeader
        layout="fill"
        className="h-full rounded-none ring-0"
        searchPlaceholder="Search"
        columnConfigurationKey="products"
        initialColumnConfiguration={initialColumnConfiguration}
        filters={filters}
        sortOptions={PRODUCT_SORT_OPTIONS}
        columns={PRODUCT_TABLE_COLUMNS}
        rows={rows}
        getRowId={(product) => product.id}
        isPending={productQuery.isPending}
        errorMessage={result && !result.success ? result.message : null}
        onRetry={retry}
        emptyTitle="No products available"
        emptyDescription="No products match the current search and filters."
        selection={{
          selectedIds,
          onChange: setSelectedIds,
          isRowSelectable: (product) =>
            !product.salesChannels.some(
              (salesChannel) => salesChannel.id === id,
            ),
          isRowSelected: (product) =>
            product.salesChannels.some(
              (salesChannel) => salesChannel.id === id,
            ),
        }}
        pagination={
          result?.success && result.data ? result.data.pagination : undefined
        }
      />
    </RouteFullscreenSurface>
  );
}
