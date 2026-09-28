import { DialogFooterActions } from "@/components/dialog/dialog-footer-actions";
import { RouteFullscreenSurface } from "@/components/dialog/route-fullscreen-surface";
import { useRouteModalClose } from "@/components/dialog/route-form-modal";
import { Input } from "@/components/ui/input";
import type { InventoryListItemDTO } from "@/lib/inventory/dto/inventory.dto";
import type { DashboardSearch } from "@/lib/validations/dashboard-search";
import type { DataTableColumn } from "@/routes/_backend/dashboard/-components/data-table-card";
import { DataTableCard } from "@/routes/_backend/dashboard/-components/data-table-card";
import {
  inventoryQueries,
  normalizeInventoryListParams,
} from "@queries/inventory.queries";
import {
  productQueries,
  productVariantQueries,
} from "@queries/product.queries";
import { updateVariantInventoryKit } from "@/server/product/variants.serverFn";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams, useSearch } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

const InventoryKit = () => {
  const { id: productId, childId: variantId } = useParams({
    strict: false,
  }) as { id: string; childId: string };
  const search = useSearch({ strict: false }) as DashboardSearch;
  const close = useRouteModalClose();
  const queryClient = useQueryClient();
  const [selectedIds, setSelectedIds] = useState<Set<string> | null>(null);
  const [requiredQuantities, setRequiredQuantities] = useState<
    Record<string, number>
  >({});
  const [pending, setPending] = useState(false);

  const variantQuery = useQuery(productVariantQueries.detail(variantId));
  const kitQuery = useQuery(productVariantQueries.inventoryKit(variantId));
  const itemParams = normalizeInventoryListParams({ ...search, limit: 50 });
  const inventoryQuery = useQuery(inventoryQueries.list(itemParams));
  const variant = variantQuery.data?.success
    ? variantQuery.data.data.variant
    : null;
  const currentKit = kitQuery.data?.success ? kitQuery.data.data.items : [];
  const inventoryItems = inventoryQuery.data?.success
    ? inventoryQuery.data.data.items
    : [];
  const selected = selectedIds ?? new Set<string>();

  useEffect(() => {
    if (selectedIds !== null || !kitQuery.data?.success) return;
    const initial = kitQuery.data.data.items;
    setSelectedIds(new Set(initial.map((item) => item.inventoryItemId)));
    setRequiredQuantities(
      Object.fromEntries(
        initial.map((item) => [item.inventoryItemId, item.requiredQuantity]),
      ),
    );
  }, [kitQuery.data, selectedIds]);

  const columns = useMemo<DataTableColumn<InventoryListItemDTO>[]>(
    () => [
      {
        key: "item",
        header: "Inventory item",
        className: "min-w-56 font-medium",
        cell: (item) => item.title ?? "Untitled inventory item",
      },
      {
        key: "sku",
        header: "SKU",
        className: "min-w-32 text-muted-foreground",
        cell: (item) => item.sku ?? "—",
      },
      {
        key: "available",
        header: "Available",
        className: "w-28 text-right",
        cell: (item) =>
          `${item.availableQuantity}${item.unitOfMeasure ? ` ${item.unitOfMeasure}` : ""}`,
      },
      {
        key: "requiredQuantity",
        header: "Required per sale",
        className: "w-44",
        cell: (item) => (
          <div className="flex items-center gap-2">
            <Input
              type="number"
              min={0}
              max={1_000_000_000}
              step="any"
              className="h-8 w-24"
              value={String(requiredQuantities[item.id] ?? 1)}
              disabled={!selected.has(item.id)}
              aria-label={`Required quantity per sale for ${item.title ?? item.id}${item.unitOfMeasure ? ` (${item.unitOfMeasure})` : ""}`}
              onClick={(event) => event.stopPropagation()}
              onChange={(event) => {
                const value = Number(event.currentTarget.value);
                setRequiredQuantities((previous) => ({
                  ...previous,
                  [item.id]: value,
                }));
              }}
            />
            {item.unitOfMeasure ? (
              <span className="text-xs text-muted-foreground">
                {item.unitOfMeasure}
              </span>
            ) : null}
          </div>
        ),
      },
    ],
    [requiredQuantities, selected],
  );

  const submit = async () => {
    if (!variant) return;
    if (selected.size > 100) {
      toast.error("A variant can include up to 100 inventory items");
      return;
    }
    if (variant.manageInventory && selected.size === 0) {
      toast.error("A managed variant must use at least one inventory item");
      return;
    }
    const items = [...selected].map((inventoryItemId) => ({
      inventoryItemId,
      requiredQuantity: Number(requiredQuantities[inventoryItemId] ?? 1),
    }));
    if (
      items.some(
        (item) =>
          !Number.isFinite(item.requiredQuantity) ||
          item.requiredQuantity < 1 ||
          item.requiredQuantity > 1_000_000_000,
      )
    ) {
      toast.error("Each required quantity must be greater than zero");
      return;
    }

    setPending(true);
    try {
      const result = await updateVariantInventoryKit({
        data: {
          productId,
          variantId,
          expectedUpdatedAt: variant.updatedAt.toISOString(),
          items,
        },
      });
      if (!result.success) {
        toast.error(result.message, { position: "top-center" });
        return;
      }
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: productVariantQueries.all(),
        }),
        queryClient.invalidateQueries({ queryKey: inventoryQueries.all() }),
        queryClient.invalidateQueries({ queryKey: productQueries.all() }),
      ]);
      toast.success(result.message, { position: "top-center" });
      close();
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Failed to update inventory kit",
        { position: "top-center" },
      );
    } finally {
      setPending(false);
    }
  };

  if (variantQuery.isPending || kitQuery.isPending) {
    return (
      <RouteFullscreenSurface label="Manage inventory kit" onClose={close}>
        <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
          Loading variant inventory…
        </div>
      </RouteFullscreenSurface>
    );
  }
  if (!variant || !kitQuery.data?.success) {
    return (
      <RouteFullscreenSurface label="Manage inventory kit" onClose={close}>
        <div className="flex h-full items-center justify-center px-6 text-sm text-destructive">
          {variantQuery.data?.success
            ? (kitQuery.data?.message ?? "Inventory kit could not be loaded")
            : (variantQuery.data?.message ?? "Variant not found")}
        </div>
      </RouteFullscreenSurface>
    );
  }

  return (
    <RouteFullscreenSurface
      label={`Inventory kit · ${variant.title}`}
      onClose={close}
      bodyClassName="overflow-hidden p-0"
      footer={
        <DialogFooterActions
          isSheet={false}
          isLoading={pending}
          isDisabled={!variant || selected.size > 100}
          onCancel={close}
          onSubmit={() => void submit()}
          submitLabel={`Save ${selected.size || ""} inventory items`}
          loadingLabel="Saving…"
        />
      }
    >
      <div className="flex h-full min-h-0 flex-col gap-3 p-4 sm:p-6">
        <div className="shrink-0 text-sm text-muted-foreground">
          Select the stock items consumed by one sale of this variant, then set
          each component quantity. Inventory changes are blocked while an active
          cart or unfulfilled order holds stock for this variant.
        </div>
        {!variant.manageInventory ? (
          <div className="shrink-0 rounded-md border border-border px-3 py-2 text-sm text-muted-foreground">
            Inventory tracking is off for this variant. The kit can be prepared
            now; stock checks begin when inventory tracking is enabled.
          </div>
        ) : null}
        <div className="min-h-0 flex-1">
          <DataTableCard
            label="Inventory items"
            hideHeader
            layout="fill"
            className="h-full rounded-none ring-0"
            searchPlaceholder="Search inventory items"
            sortOptions={[
              { value: "name", label: "Name" },
              { value: "createdAt", label: "Created" },
              { value: "updatedAt", label: "Updated" },
            ]}
            columns={columns}
            rows={inventoryItems}
            getRowId={(item) => item.id}
            isPending={inventoryQuery.isPending}
            errorMessage={
              inventoryQuery.data && !inventoryQuery.data.success
                ? inventoryQuery.data.message
                : null
            }
            onRetry={() =>
              void queryClient.invalidateQueries({
                queryKey: inventoryQueries.all(),
              })
            }
            emptyTitle="No inventory items"
            emptyDescription="Create an inventory item before building a kit."
            selection={{
              selectedIds: selected,
              onChange: (next) => {
                const previous = selected;
                setSelectedIds(next);
                setRequiredQuantities((current) => {
                  const updated = { ...current };
                  for (const itemId of next) {
                    if (
                      !previous.has(itemId) &&
                      updated[itemId] === undefined
                    ) {
                      updated[itemId] =
                        currentKit.find(
                          (item) => item.inventoryItemId === itemId,
                        )?.requiredQuantity ?? 1;
                    }
                  }
                  return updated;
                });
              },
            }}
            pagination={
              inventoryQuery.data?.success
                ? inventoryQuery.data.data.pagination
                : undefined
            }
          />
        </div>
      </div>
    </RouteFullscreenSurface>
  );
};

export default InventoryKit;
