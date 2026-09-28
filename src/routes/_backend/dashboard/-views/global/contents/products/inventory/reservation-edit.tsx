import { RouteSurfaceMessage } from "@/components/dialog/route-surface-message";
import { RouteSurfacePending } from "@/components/dialog/route-surface-pending";
import {
  RouteFormPage,
  useRouteModalClose,
  type RouteFormState,
} from "@/components/dialog/route-form-modal";
import { inventoryQueries } from "@queries/inventory.queries";
import { reservationQueries } from "@queries/reservation.queries";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "@tanstack/react-router";
import { toast } from "sonner";
import { updateReservationAction } from "./reservation-actions";
import { reservationFormFields } from "./reservation-form-fields";

const ReservationEdit = () => {
  const { id } = useParams({ strict: false }) as { id: string };
  const queryClient = useQueryClient();
  const close = useRouteModalClose();
  const { data: reservationResult, isPending } = useQuery(
    reservationQueries.detail(id),
  );
  const reservation = reservationResult?.success
    ? reservationResult.data
    : null;
  const { data: itemResult, isPending: itemPending } = useQuery({
    ...inventoryQueries.detail(reservation?.inventoryItemId ?? "__no-item__"),
    enabled: Boolean(reservation?.inventoryItemId),
  });
  const item = itemResult?.success ? itemResult.data : null;

  const submit = async (
    _state: RouteFormState,
    formData: FormData,
  ): Promise<RouteFormState> => {
    formData.set("id", id);
    const response = await updateReservationAction({ data: formData });
    if (!response.success) {
      toast.error(response.message, { position: "top-center" });
      return response;
    }
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: reservationQueries.all() }),
      queryClient.invalidateQueries({ queryKey: inventoryQueries.all() }),
    ]);
    toast.success("Reservation updated", { position: "top-center" });
    close();
    return response;
  };

  if (isPending || (reservation?.inventoryItemId && itemPending)) {
    return <RouteSurfacePending />;
  }
  if (!reservation) {
    return (
      <RouteSurfaceMessage>
        {reservationResult?.message ?? "Reservation not found"}
      </RouteSurfaceMessage>
    );
  }
  if (!reservation.isManual) {
    return (
      <RouteSurfaceMessage>
        Cart and order reservations are managed by their commerce workflow.
      </RouteSurfaceMessage>
    );
  }
  if (!item) {
    return (
      <RouteSurfaceMessage>
        {itemResult?.message ?? "Inventory item not found"}
      </RouteSurfaceMessage>
    );
  }

  return (
    <RouteFormPage
      title="Edit Reservation"
      description={`${item.title ?? "Inventory item"} · ${reservation.locationName ?? "Unavailable location"}`}
      action={submit}
      submitLabel="Save"
      loadingLabel="Saving..."
      fields={reservationFormFields({
        items: [],
        item,
        reservation,
        fixedInventoryItemId: reservation.inventoryItemId,
      })}
    />
  );
};

export default ReservationEdit;
