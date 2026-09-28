import type { ReservationDTO } from "@/lib/inventory/dto/reservation.dto";
import { viewPreloader } from "@/lib/config/lazy-view";
import { findCollection } from "@/lib/config/navigation";
import type { DashboardSearch } from "@/lib/validations/dashboard-search";
import {
  CollectionCreateButton,
  DataTableCard,
  editActionIcon,
  type DataTableColumn,
} from "@/routes/_backend/dashboard/-components/data-table-card";
import { getConfig } from "@/server/get-config";
import {
  reservationQueries,
  normalizeReservationListParams,
} from "@queries/reservation.queries";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  useLocation,
  useNavigate,
  useRouter,
  useSearch,
} from "@tanstack/react-router";
import { useCallback, useMemo } from "react";

const columns: DataTableColumn<ReservationDTO>[] = [
  {
    key: "item",
    header: "Inventory item",
    className: "min-w-56 font-medium",
    cell: (reservation) => reservation.inventoryItemTitle ?? "-",
  },
  {
    key: "sku",
    header: "SKU",
    className: "w-40 text-muted-foreground",
    cell: (reservation) => reservation.inventoryItemSku ?? "-",
  },
  {
    key: "location",
    header: "Location",
    className: "min-w-36",
    cell: (reservation) => reservation.locationName ?? "Unavailable",
  },
  {
    key: "quantity",
    header: "Quantity",
    className: "w-24",
    cell: (reservation) => reservation.quantity,
  },
  {
    key: "type",
    header: "Type",
    className: "w-28",
    cell: (reservation) => (reservation.isManual ? "Manual" : "Automatic"),
  },
  {
    key: "description",
    header: "Description",
    className: "min-w-48 text-muted-foreground",
    cell: (reservation) => reservation.description ?? "-",
  },
];

const Reservations = () => {
  const navigate = useNavigate();
  const router = useRouter();
  const queryClient = useQueryClient();
  const returnTo = useLocation({ select: (location) => location.href });
  const detailView = useMemo(
    () =>
      findCollection(getConfig().client.collections.global, "reservations")
        ?.detail?.view,
    [],
  );
  const search = useSearch({ strict: false }) as DashboardSearch;
  const params = normalizeReservationListParams(search);
  const { data: result, isPending } = useQuery(reservationQueries.list(params));
  const reservations = result?.success ? result.data.reservations : [];
  const invalidate = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: reservationQueries.all() });
  }, [queryClient]);

  return (
    <DataTableCard
      label="Reservations"
      description="Track stock held for carts, orders, and manual reservations."
      headerActions={<CollectionCreateButton slug="reservations" />}
      searchPlaceholder="Search inventory or reservation"
      sortOptions={[
        { value: "createdAt", label: "Created" },
        { value: "updatedAt", label: "Updated" },
      ]}
      columns={columns}
      rows={reservations}
      getRowId={(reservation) => reservation.id}
      isRowClickable={() => true}
      onRowClick={(reservation) =>
        void navigate({
          to: "/dashboard/$slug/$id",
          params: { slug: "reservations", id: reservation.id },
          search: { returnTo },
        })
      }
      onRowPreload={(reservation) => {
        void viewPreloader(detailView)?.();
        void router.preloadRoute({
          to: "/dashboard/$slug/$id",
          params: { slug: "reservations", id: reservation.id },
          search: { returnTo },
        });
      }}
      rowActions={(reservation) =>
        reservation.isManual
          ? [
              {
                label: "Edit reservation",
                icon: editActionIcon,
                onSelect: () =>
                  void navigate({
                    to: "/dashboard/$slug/$id/edit",
                    params: { slug: "reservations", id: reservation.id },
                  }),
              },
            ]
          : []
      }
      isPending={isPending}
      errorMessage={result && !result.success ? result.message : null}
      onRetry={invalidate}
      emptyTitle="No reservations"
      emptyDescription="Create a manual reservation or place an order to hold inventory."
      pagination={result?.success ? result.data.pagination : undefined}
    />
  );
};

export default Reservations;
