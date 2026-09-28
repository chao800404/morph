import { RouteSurfaceMessage } from "@/components/dialog/route-surface-message";
import { RouteSurfacePending } from "@/components/dialog/route-surface-pending";
import {
  RouteFormPage,
  useRouteModalClose,
  type RouteFormState,
} from "@/components/dialog/route-form-modal";
import type { FormField } from "@/lib/validations/form";
import { inventoryQueries } from "@queries/inventory.queries";
import {
  stockLocationQueries,
  type StockLocationListParams,
} from "@queries/stock-location.queries";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "@tanstack/react-router";
import { toast } from "sonner";
import { saveInventoryLocationLevelAction } from "./inventory-actions";

const CREATE_LOCATION = "create";

const InventoryLocationLevel = () => {
  const { id, childId } = useParams({ strict: false }) as {
    id: string;
    childId: string;
  };
  const creating = childId === CREATE_LOCATION;
  const queryClient = useQueryClient();
  const close = useRouteModalClose();
  const { data: itemResult, isPending: itemPending } = useQuery(
    inventoryQueries.detail(id),
  );
  const { data: locationResult, isPending: locationsPending } = useQuery(
    stockLocationQueries.list({
      sortBy: "name",
      sortOrder: "asc",
      page: 1,
      limit: 100,
    } satisfies StockLocationListParams),
  );
  const item = itemResult?.success ? itemResult.data : null;
  const locations = locationResult?.success
    ? locationResult.data.locations
    : [];
  const currentLevel = creating
    ? null
    : (item?.locationLevels.find((level) => level.locationId === childId) ??
      null);
  const currentLocation = locations.find((location) => location.id === childId);
  const linkedLocationIds = new Set(
    item?.locationLevels.map((level) => level.locationId) ?? [],
  );
  const availableLocations = locations.filter(
    (location) => !linkedLocationIds.has(location.id),
  );

  const fields: FormField[] = [
    ...(creating
      ? [
          {
            type: "select" as const,
            name: "locationId",
            label: "Stock location",
            value: "__select_location__",
            required: true,
            options: [
              { value: "__select_location__", label: "Select a location" },
              ...availableLocations.map((location) => ({
                value: location.id,
                label: location.name,
              })),
            ],
          },
        ]
      : [
          {
            type: "input" as const,
            name: "locationName",
            label: "Stock location",
            value: currentLocation?.name ?? "Unavailable location",
            disabled: true,
          },
        ]),
    {
      type: "input",
      name: "stockedQuantity",
      label: "In-stock quantity",
      inputType: "number",
      step: "any",
      value: String(currentLevel?.stockedQuantity ?? 0),
      required: true,
      description:
        `The physical quantity currently available at this location${item?.unitOfMeasure ? ` (${item.unitOfMeasure})` : ""}.`,
    },
    {
      type: "input",
      name: "incomingQuantity",
      label: "Incoming quantity",
      inputType: "number",
      step: "any",
      value: String(currentLevel?.incomingQuantity ?? 0),
      required: true,
      description: `Quantity expected to arrive at this location${item?.unitOfMeasure ? ` (${item.unitOfMeasure})` : ""}.`,
    },
  ];

  const submit = async (
    _state: RouteFormState,
    formData: FormData,
  ): Promise<RouteFormState> => {
    formData.set("inventoryItemId", id);
    if (!creating) formData.set("locationId", childId);
    const response = await saveInventoryLocationLevelAction({ data: formData });
    if (!response.success) {
      toast.error(response.message, { position: "top-center" });
      return response;
    }
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: inventoryQueries.all() }),
      queryClient.invalidateQueries({
        queryKey: inventoryQueries.detail(id).queryKey,
      }),
    ]);
    toast.success(creating ? "Location added" : "Location quantity updated", {
      position: "top-center",
    });
    close();
    return response;
  };

  if (itemPending || locationsPending) return <RouteSurfacePending />;
  if (!item) {
    return (
      <RouteSurfaceMessage>
        {itemResult?.message ?? "Inventory item not found"}
      </RouteSurfaceMessage>
    );
  }
  if (!locationResult?.success) {
    return (
      <RouteSurfaceMessage>
        {locationResult?.message ?? "Stock locations could not be loaded"}
      </RouteSurfaceMessage>
    );
  }
  if (!creating && (!currentLevel || !currentLocation)) {
    return (
      <RouteSurfaceMessage>
        This stock location is unavailable.
      </RouteSurfaceMessage>
    );
  }
  if (creating && availableLocations.length === 0) {
    return (
      <RouteSurfaceMessage>
        All active stock locations are already assigned to this item.
      </RouteSurfaceMessage>
    );
  }

  return (
    <RouteFormPage
      title={creating ? "Add Stock Location" : "Edit Location Quantity"}
      description={item.title ?? "Manage inventory by location"}
      action={submit}
      submitLabel={creating ? "Add location" : "Save"}
      loadingLabel={creating ? "Adding..." : "Saving..."}
      fields={fields}
    />
  );
};

export default InventoryLocationLevel;
