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
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { reservationQueries } from "@queries/reservation.queries";
import {
  EditCard,
  type EditCardField,
} from "@/routes/_backend/dashboard/-components/edit-card/edit-card";
import { deleteActionIcon } from "@/routes/_backend/dashboard/-components/data-table-card";
import { useState } from "react";
import { toast } from "sonner";
import { deleteReservationAction } from "./reservation-actions";

const ReservationDetail = () => {
  const { id } = useParams({ strict: false }) as { id: string };
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [deleteOpen, setDeleteOpen] = useState(false);
  const { data: result, isPending } = useQuery(reservationQueries.detail(id));
  const reservation = result?.success ? result.data : null;
  const openEdit = () =>
    void navigate({
      to: "/dashboard/$slug/$id/edit",
      params: { slug: "reservations", id },
    });

  const deleteReservation = async () => {
    const response = await deleteReservationAction(id);
    if (!response.success) {
      toast.error(response.message, { position: "top-center" });
      setDeleteOpen(false);
      return;
    }
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: reservationQueries.all() }),
      queryClient.invalidateQueries({ queryKey: ["inventory"] }),
    ]);
    toast.success("Reservation cancelled", { position: "top-center" });
    setDeleteOpen(false);
    void navigate({ to: "/dashboard/$slug", params: { slug: "reservations" } });
  };

  if (isPending) return <RouteSurfacePending />;
  if (!reservation) {
    return (
      <RouteSurfaceMessage>
        {result?.message ?? "Reservation not found"}
      </RouteSurfaceMessage>
    );
  }

  const fields: EditCardField[] = [
    {
      key: "inventoryItem",
      label: "Inventory item",
      displayValue: (
        <Link
          to="/dashboard/$slug/$id"
          params={{ slug: "inventory", id: reservation.inventoryItemId }}
          className="underline underline-offset-4"
        >
          {reservation.inventoryItemTitle ?? reservation.inventoryItemId}
          {reservation.inventoryItemSku
            ? ` · ${reservation.inventoryItemSku}`
            : ""}
        </Link>
      ),
    },
    {
      key: "location",
      label: "Location",
      value: reservation.locationName ?? "Unavailable location",
    },
    {
      key: "quantity",
      label: "Quantity",
      value: `${reservation.quantity}${reservation.inventoryItemUnitOfMeasure ? ` ${reservation.inventoryItemUnitOfMeasure}` : ""}`,
    },
    {
      key: "status",
      label: "Type",
      displayValue: (
        <Badge variant={reservation.isManual ? "outline" : "default"}>
          {reservation.isManual
            ? "Manual"
            : reservation.cartId
              ? "Cart hold"
              : "Order hold"}
        </Badge>
      ),
    },
    {
      key: "description",
      label: "Description",
      value: reservation.description ?? "-",
    },
    {
      key: "externalId",
      label: "External ID",
      value: reservation.externalId ?? "-",
    },
    {
      key: "createdBy",
      label: "Created by",
      value: reservation.createdBy ?? "-",
    },
    {
      key: "expires",
      label: "Expires",
      value: reservation.expiresAt?.toISOString() ?? "Does not expire",
    },
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end">
        <Button variant="outline" size="sm" asChild>
          <Link to="/dashboard/$slug" params={{ slug: "reservations" }}>
            Back to reservations
          </Link>
        </Button>
      </div>
      <EditCard
        id="reservation-detail"
        title={`Reservation · ${reservation.inventoryItemSku ?? reservation.inventoryItemTitle ?? reservation.id}`}
        description={
          reservation.isManual
            ? "Manual inventory hold"
            : "Managed by the cart or order workflow"
        }
        fields={fields}
        onEdit={reservation.isManual ? openEdit : undefined}
        actions={
          reservation.isManual
            ? [
                {
                  label: "Cancel reservation",
                  icon: deleteActionIcon,
                  destructive: true,
                  onSelect: () => setDeleteOpen(true),
                },
              ]
            : undefined
        }
      />
      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel this reservation?</AlertDialogTitle>
            <AlertDialogDescription>
              Cancelling it releases {reservation.quantity}{" "}
              {reservation.inventoryItemUnitOfMeasure ?? "units"} back to the
              selected location.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep reservation</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={(event) => {
                event.preventDefault();
                void deleteReservation();
              }}
            >
              Cancel reservation
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default ReservationDetail;
