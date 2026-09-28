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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { RouteSurfaceMessage } from "@/components/dialog/route-surface-message";
import { RouteSurfacePending } from "@/components/dialog/route-surface-pending";
import { inventoryQueries } from "@queries/inventory.queries";
import type { InventoryLocationLevelDTO } from "@/lib/inventory/dto/inventory.dto";
import {
  DataTableCard,
  deleteActionIcon,
  editActionIcon,
  type DataTableColumn,
} from "@/routes/_backend/dashboard/-components/data-table-card";
import {
  EditCard,
  type EditCardField,
} from "@/routes/_backend/dashboard/-components/edit-card/edit-card";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import {
  deleteInventoryItemAction,
  removeInventoryLocationLevelAction,
} from "./inventory-actions";

const levelColumns: DataTableColumn<InventoryLocationLevelDTO>[] = [
  {
    key: "location",
    header: "Location",
    className: "min-w-48 font-medium",
    cell: (level) => level.locationName ?? "Unavailable location",
  },
  {
    key: "stocked",
    header: "In stock",
    className: "w-28",
    cell: (level) =>
      `${level.stockedQuantity}${level.unitOfMeasure ? ` ${level.unitOfMeasure}` : ""}`,
  },
  {
    key: "reserved",
    header: "Reserved",
    className: "w-28",
    cell: (level) =>
      `${level.reservedQuantity}${level.unitOfMeasure ? ` ${level.unitOfMeasure}` : ""}`,
  },
  {
    key: "incoming",
    header: "Incoming",
    className: "w-28",
    cell: (level) =>
      `${level.incomingQuantity}${level.unitOfMeasure ? ` ${level.unitOfMeasure}` : ""}`,
  },
  {
    key: "available",
    header: "Available",
    className: "w-28",
    cell: (level) =>
      `${level.availableQuantity}${level.unitOfMeasure ? ` ${level.unitOfMeasure}` : ""}`,
  },
];

const InventoryDetail = () => {
  const { id } = useParams({ strict: false }) as { id: string };
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [removingLevel, setRemovingLevel] =
    useState<InventoryLocationLevelDTO | null>(null);
  const { data: result, isPending } = useQuery(inventoryQueries.detail(id));
  const item = result?.success ? result.data : null;

  const openEditor = () =>
    void navigate({
      to: "/dashboard/$slug/$id/edit",
      params: { slug: "inventory", id },
    });
  const openLocationLevel = (locationId: string) =>
    void navigate({
      to: "/dashboard/$slug/$id/$page/$childId",
      params: {
        slug: "inventory",
        id,
        page: "location-levels",
        childId: locationId,
      },
    });
  const openAddLocation = () => openLocationLevel("create");
  const openReservations = () =>
    void navigate({
      to: "/dashboard/$slug",
      params: { slug: "reservations" },
      search: { inventoryItemId: id },
    });
  const createReservation = () =>
    void navigate({
      to: "/dashboard/$slug/create",
      params: { slug: "reservations" },
      search: {
        inventoryItemId: id,
        returnTo: `/dashboard/inventory/${id}`,
      },
    });

  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: inventoryQueries.all() }),
      queryClient.invalidateQueries({
        queryKey: inventoryQueries.detail(id).queryKey,
      }),
    ]);
  };

  const removeLocation = async () => {
    if (!removingLevel) return;
    const response = await removeInventoryLocationLevelAction({
      inventoryItemId: id,
      locationId: removingLevel.locationId,
    });
    if (!response.success) {
      toast.error(response.message, { position: "top-center" });
      setRemovingLevel(null);
      return;
    }
    await refresh();
    toast.success("Location removed", { position: "top-center" });
    setRemovingLevel(null);
  };

  const deleteItem = async () => {
    const response = await deleteInventoryItemAction(id);
    if (!response.success) {
      toast.error(response.message, { position: "top-center" });
      setDeleteOpen(false);
      return;
    }
    await refresh();
    toast.success("Inventory item deleted", { position: "top-center" });
    setDeleteOpen(false);
    void navigate({ to: "/dashboard/$slug", params: { slug: "inventory" } });
  };

  if (isPending) return <RouteSurfacePending />;
  if (!item) {
    return (
      <RouteSurfaceMessage>
        {result?.message ?? "Inventory item not found"}
      </RouteSurfaceMessage>
    );
  }

  const detailFields: EditCardField[] = [
    { key: "sku", label: "SKU", value: item.sku ?? "-" },
    {
      key: "unitOfMeasure",
      label: "Unit of measure",
      value: item.unitOfMeasure ?? "-",
    },
    {
      key: "shipping",
      label: "Shipping",
      displayValue: (
        <Badge variant={item.requiresShipping ? "default" : "outline"}>
          {item.requiresShipping ? "Requires shipping" : "No shipping"}
        </Badge>
      ),
    },
    {
      key: "description",
      label: "Description",
      value: item.description ?? "-",
    },
    {
      key: "weight",
      label: "Weight",
      value: item.weight === null ? "-" : String(item.weight),
    },
    {
      key: "dimensions",
      label: "Dimensions",
      value: [item.length, item.width, item.height].some(
        (value) => value !== null,
      )
        ? `${item.length ?? "-"} × ${item.width ?? "-"} × ${item.height ?? "-"}`
        : "-",
    },
    {
      key: "origin",
      label: "Country of origin",
      value: item.originCountry?.toUpperCase() ?? "-",
    },
    { key: "hsCode", label: "HS code", value: item.hsCode ?? "-" },
    { key: "midCode", label: "MID code", value: item.midCode ?? "-" },
    { key: "material", label: "Material", value: item.material ?? "-" },
  ];

  return (
    <div className="flex flex-col gap-4">
      <EditCard
        id="inventory-item-detail"
        title={item.title ?? "Inventory item"}
        description={
          item.variantCount > 0
            ? `Shared inventory linked to ${item.variantCount} variants.`
            : "Standalone inventory item"
        }
        fields={detailFields}
        onEdit={openEditor}
        actions={[
          {
            label: "Delete inventory item",
            icon: deleteActionIcon,
            destructive: true,
            disabled:
              item.variantCount > 0 ||
              item.stockedQuantity > 0 ||
              item.reservedQuantity > 0 ||
              item.incomingQuantity > 0,
            onSelect: () => setDeleteOpen(true),
          },
        ]}
      />
      <DataTableCard
        label="Locations"
        description="Manage where this item is stocked and update each location's quantities."
        headerActions={
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={openReservations}>
              Manage reservations
            </Button>
            <Button size="sm" onClick={createReservation}>
              Create reservation
            </Button>
            <Button size="sm" variant="outline" onClick={openAddLocation}>
              Manage locations
            </Button>
          </div>
        }
        columns={levelColumns}
        rows={item.locationLevels}
        getRowId={(level) => level.id}
        rowActions={(level) => [
          ...(level.locationName
            ? [
                {
                  label: "Edit quantity",
                  icon: editActionIcon,
                  onSelect: () => openLocationLevel(level.locationId),
                },
              ]
            : []),
          {
            label: "Remove from location",
            icon: deleteActionIcon,
            destructive: true,
            disabled:
              level.stockedQuantity > 0 ||
              level.reservedQuantity > 0 ||
              level.incomingQuantity > 0,
            onSelect: () => setRemovingLevel(level),
          },
        ]}
        emptyTitle="No locations assigned"
        emptyDescription="Add a stock location to manage this item's quantities."
      />
      <AlertDialog
        open={Boolean(removingLevel)}
        onOpenChange={(open) => !open && setRemovingLevel(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove item from this location?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes the location level. It can only be removed when no
              stock, incoming quantity, or reservation remains.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={(event) => {
                event.preventDefault();
                void removeLocation();
              }}
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this inventory item?</AlertDialogTitle>
            <AlertDialogDescription>
              This item will be archived. Items linked to product variants or
              with remaining stock cannot be deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={(event) => {
                event.preventDefault();
                void deleteItem();
              }}
            >
              Delete item
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default InventoryDetail;
