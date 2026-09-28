import { RouteSurfaceMessage } from "@/components/dialog/route-surface-message";
import { RouteSurfacePending } from "@/components/dialog/route-surface-pending";
import type { DashboardSearch } from "@/lib/validations/dashboard-search";
import {
  RouteFormPage,
  useRouteModalClose,
  type RouteFormState,
} from "@/components/dialog/route-form-modal";
import {
  inventoryQueries,
  normalizeInventoryListParams,
} from "@queries/inventory.queries";
import { reservationQueries } from "@queries/reservation.queries";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearch } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { createReservationAction } from "./reservation-actions";
import { reservationFormFields } from "./reservation-form-fields";

const ReservationCreate = () => {
  const queryClient = useQueryClient();
  const close = useRouteModalClose();
  const search = useSearch({ strict: false }) as DashboardSearch;
  const [selectedItemId, setSelectedItemId] = useState(
    search.inventoryItemId ?? "",
  );
  const [selectedLocationId, setSelectedLocationId] = useState("");
  const listParams = normalizeInventoryListParams({ limit: 100 });
  const { data: listResult, isPending: listPending } = useQuery(
    inventoryQueries.list(listParams),
  );
  const items = listResult?.success ? listResult.data.items : [];
  const { data: itemResult, isPending: itemPending } = useQuery({
    ...inventoryQueries.detail(selectedItemId || "__no-item-selected__"),
    enabled: Boolean(selectedItemId && selectedItemId !== "__select_item__"),
  });
  const item = itemResult?.success ? itemResult.data : null;

  const submit = async (
    _state: RouteFormState,
    formData: FormData,
  ): Promise<RouteFormState> => {
    const response = await createReservationAction({ data: formData });
    if (!response.success) {
      toast.error(response.message, { position: "top-center" });
      return response;
    }
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: reservationQueries.all() }),
      queryClient.invalidateQueries({ queryKey: inventoryQueries.all() }),
    ]);
    toast.success("Reservation created", { position: "top-center" });
    close();
    return response;
  };

  if (listPending) return <RouteSurfacePending />;
  if (!listResult?.success) {
    return (
      <RouteSurfaceMessage>
        {listResult?.message ?? "Inventory items could not be loaded"}
      </RouteSurfaceMessage>
    );
  }
  if (items.length === 0) {
    return (
      <RouteSurfaceMessage>Create an inventory item first.</RouteSurfaceMessage>
    );
  }
  if (selectedItemId && selectedItemId !== "__select_item__" && itemPending) {
    return <RouteSurfacePending />;
  }
  if (selectedItemId && !itemResult?.success) {
    return (
      <RouteSurfaceMessage>
        {itemResult?.message ?? "Inventory item could not be loaded"}
      </RouteSurfaceMessage>
    );
  }
  if (item && !item.locationLevels.some((level) => level.locationName)) {
    return (
      <RouteSurfaceMessage>
        Assign this inventory item to a stock location before creating a
        reservation.
      </RouteSurfaceMessage>
    );
  }

  return (
    <RouteFormPage
      title="Create Reservation"
      description="Reserve inventory at a specific stock location."
      action={submit}
      fields={reservationFormFields({
        items,
        item,
        selectedItemId,
        selectedLocationId,
      })}
      onFieldChange={(name, value) => {
        if (name === "inventoryItemId" && typeof value === "string") {
          setSelectedItemId(value === "__select_item__" ? "" : value);
          setSelectedLocationId("");
        }
        if (name === "locationId" && typeof value === "string") {
          setSelectedLocationId(value === "__select_location__" ? "" : value);
        }
      }}
    />
  );
};

export default ReservationCreate;
