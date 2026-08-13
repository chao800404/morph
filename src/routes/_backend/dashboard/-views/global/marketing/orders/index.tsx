import type { OrderListDTO } from "@/lib/order/dto/order.dto";
import type { DashboardSearch } from "@/lib/validations/dashboard-search";
import {
  CollectionCreateButton,
  DataTableCard,
  useCollectionDetailPreload,
  type DataTableColumn,
} from "@/routes/_backend/dashboard/-components/data-table-card";
import {
  normalizeOrderListParams,
  orderQueries,
} from "@queries/marketing.queries";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { useCallback, useMemo } from "react";
import { OrderStatusBadge } from "../status-badges";

const money = (amount: number, currency: string) =>
  new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: currency.toUpperCase(),
  }).format(amount / 100);

const Orders = () => {
  const search = useSearch({ strict: false }) as DashboardSearch;
  const navigate = useNavigate();
  const preloadDetail = useCollectionDetailPreload("orders");
  const queryClient = useQueryClient();
  const params = normalizeOrderListParams(search);
  const { data: result, isPending } = useQuery(orderQueries.list(params));
  const invalidate = useCallback(
    () => void queryClient.invalidateQueries({ queryKey: orderQueries.all() }),
    [queryClient],
  );
  const columns = useMemo<DataTableColumn<OrderListDTO>[]>(
    () => [
      {
        key: "order",
        header: "Order",
        className: "w-32 font-medium",
        cell: (row) => `#${row.displayId}`,
      },
      {
        key: "date",
        header: "Date",
        className: "w-40 text-muted-foreground",
        cell: (row) => new Date(row.createdAt).toLocaleDateString(),
      },
      { key: "customer", header: "Customer", cell: (row) => row.email || "—" },
      {
        key: "status",
        header: "Status",
        className: "w-40",
        cell: (row) => <OrderStatusBadge status={row.status} variant="plain" />,
      },
      {
        key: "total",
        header: "Total",
        className: "w-40",
        cell: (row) => money(row.total, row.currencyCode),
      },
    ],
    [],
  );
  const rows = result?.success ? result.data.orders : [];
  return (
    <DataTableCard
      label="Orders"
      description="Manage customer orders and fulfillment."
      headerActions={<CollectionCreateButton slug="orders" />}
      searchPlaceholder="Search orders"
      sortOptions={[
        { value: "createdAt", label: "Created" },
        { value: "updatedAt", label: "Updated" },
      ]}
      columns={columns}
      rows={rows}
      getRowId={(row) => row.id}
      isPending={isPending}
      errorMessage={result && !result.success ? result.message : null}
      onRetry={invalidate}
      emptyTitle="No orders yet"
      emptyDescription="Orders placed by customers and drafts created by your team appear here."
      onRowClick={(row) =>
        void navigate({
          to: "/dashboard/$slug/$id",
          params: { slug: "orders", id: row.id },
        })
      }
      onRowPreload={(row) => preloadDetail(row.id)}
      pagination={result?.success ? result.data.pagination : undefined}
    />
  );
};

export default Orders;
