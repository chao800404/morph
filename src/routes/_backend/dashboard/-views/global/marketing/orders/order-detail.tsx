import { Button } from "@/components/ui/button";
import { OrderDetailSkeleton } from "@/routes/_backend/dashboard/-components/loading/collection-page-skeletons";
import type {
  OrderDetailDTO,
  OrderFulfillmentDTO,
  OrderItemDTO,
} from "@/lib/order/dto/order.dto";
import type { DashboardSearch } from "@/lib/validations/dashboard-search";
import {
  DataTableCard,
  type DataTableColumn,
} from "@/routes/_backend/dashboard/-components/data-table-card";
import {
  EditCard,
  type EditCardField,
} from "@/routes/_backend/dashboard/-components/edit-card/edit-card";
import {
  normalizeOrderFulfillmentListParams,
  normalizeOrderItemListParams,
  orderQueries,
} from "@queries/marketing.queries";
import { useQuery } from "@tanstack/react-query";
import { useQueryClient } from "@tanstack/react-query";
import {
  Link,
  useNavigate,
  useParams,
  useSearch,
} from "@tanstack/react-router";
import { useCallback, useMemo } from "react";
import { OrderStatusBadge } from "../status-badges";
import { PageSplitLayout } from "@/routes/_backend/dashboard/-components/layout/page-split-layout";
import { MetadataCard } from "@/routes/_backend/dashboard/-components/metadata-card/metadata-card";
import {
  RowActionsMenu,
  type RowAction,
} from "@/routes/_backend/dashboard/-components/data-table-card/row-actions-menu";
import { useInfoStore } from "@views/features/global-info/use-info-store";
import { useShallow } from "zustand/react/shallow";
import {
  cancelOrderAction,
  cancelOrderFulfillmentAction,
  captureOrderPaymentAction,
  deliverOrderFulfillmentAction,
  shipOrderFulfillmentAction,
} from "./order-workflow-actions";
import { Ban, BanknoteArrowDown, PackageCheck, Truck } from "lucide-react";

const money = (amount: number, currency: string) =>
  new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: currency.toUpperCase(),
  }).format(amount / 100);
const addressText = (address: OrderDetailDTO["shippingAddress"]) =>
  address
    ? [
        address.firstName,
        address.lastName,
        address.company,
        address.address1,
        address.address2,
        address.city,
        address.province,
        address.postalCode,
        address.countryCode?.toUpperCase(),
      ]
        .filter(Boolean)
        .join(", ")
    : "—";

const OrderDetail = () => {
  const { id } = useParams({ strict: false }) as { id: string };
  const search = useSearch({ strict: false }) as DashboardSearch;
  const navigate = useNavigate();
  const client = useQueryClient();
  const { setInfoData, setOpen: setInfoOpen } = useInfoStore(
    useShallow((state) => ({
      setInfoData: state.setInfoData,
      setOpen: state.setOpen,
    })),
  );
  const { data: result, isPending } = useQuery(orderQueries.detail(id));
  const itemQuery = useQuery(
    orderQueries.items(normalizeOrderItemListParams(id, search)),
  );
  const fulfillmentQuery = useQuery(
    orderQueries.fulfillments(normalizeOrderFulfillmentListParams(id, search)),
  );
  const order = result?.success ? result.data : null;
  const itemResult = itemQuery.data?.success ? itemQuery.data.data : null;
  const fulfillmentResult = fulfillmentQuery.data?.success
    ? fulfillmentQuery.data.data
    : null;
  const itemColumns = useMemo<DataTableColumn<OrderItemDTO>[]>(
    () => [
      {
        key: "title",
        header: "Item",
        className: "font-medium",
        cell: (item) => item.title,
      },
      {
        key: "sku",
        header: "SKU",
        className: "text-muted-foreground",
        cell: (item) => item.sku || "—",
      },
      {
        key: "quantity",
        header: "Quantity",
        className: "w-28",
        cell: (item) => item.quantity,
      },
      {
        key: "fulfilled",
        header: "Fulfilled",
        className: "w-28",
        cell: (item) => item.fulfilledQuantity,
      },
      {
        key: "total",
        header: "Total",
        className: "w-36",
        cell: (item) =>
          money(item.unitPrice * item.quantity, order?.currencyCode ?? "usd"),
      },
    ],
    [order?.currencyCode],
  );
  const fulfillmentColumns = useMemo<DataTableColumn<OrderFulfillmentDTO>[]>(
    () => [
      {
        key: "items",
        header: "Items",
        cell: (fulfillment) =>
          fulfillment.items
            .map((item) => `${item.title} × ${item.quantity}`)
            .join(", "),
      },
      {
        key: "location",
        header: "Location",
        className: "w-48 text-muted-foreground",
        cell: (fulfillment) => fulfillment.locationId,
      },
      {
        key: "status",
        header: "Status",
        className: "w-32",
        cell: (fulfillment) =>
          fulfillment.canceledAt
            ? "Canceled"
            : fulfillment.deliveredAt
              ? "Delivered"
              : fulfillment.shippedAt
                ? "Shipped"
                : "Ready",
      },
    ],
    [],
  );
  if (isPending) return <OrderDetailSkeleton />;
  if (!order)
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4">
        <p className="text-sm text-muted-foreground">
          {result?.message ?? "Order not found"}
        </p>
        <Button variant="outline" size="sm" asChild>
          <Link to="/dashboard/$slug" params={{ slug: "orders" }}>
            Back to orders
          </Link>
        </Button>
      </div>
    );
  const general: EditCardField[] = [
    { key: "email", label: "Customer", displayValue: order.email || "—" },
    {
      key: "createdAt",
      label: "Created",
      displayValue: new Date(order.createdAt).toLocaleString(),
    },
    {
      key: "currency",
      label: "Currency",
      displayValue: order.currencyCode.toUpperCase(),
    },
    {
      key: "total",
      label: "Total",
      displayValue: money(order.total, order.currencyCode),
    },
  ];
  const invalidate = useCallback(
    () => client.invalidateQueries({ queryKey: orderQueries.all() }),
    [client],
  );
  const confirm = useCallback(
    (options: {
      title: string;
      description: string;
      action: typeof captureOrderPaymentAction;
      fields: Array<{ type: "hidden"; name: string; value: string }>;
      label: string;
      destructive?: boolean;
    }) => {
      setInfoData({
        title: options.title,
        description: options.description,
        fields: options.fields,
        action: options.action,
        confirmLabel: options.label,
        confirmVariant: options.destructive ? "destructive" : "default",
        onSuccess: () => void invalidate(),
      });
      setInfoOpen(true);
    },
    [invalidate, setInfoData, setInfoOpen],
  );
  const payment = order.payment;
  const capturable = Math.max(
    0,
    (payment?.authorizedAmount ?? 0) - (payment?.capturedAmount ?? 0),
  );
  const refundable = Math.max(
    0,
    (payment?.capturedAmount ?? 0) - (payment?.refundedAmount ?? 0),
  );
  const orderActions: RowAction[] = [
    ...(capturable > 0
      ? ([
          {
            label: "Capture payment",
            icon: <BanknoteArrowDown />,
            onSelect: () =>
              confirm({
                title: "Capture Payment",
                description: `Capture ${money(capturable, order.currencyCode)} for this order?`,
                action: captureOrderPaymentAction,
                fields: [
                  { type: "hidden", name: "orderId", value: id },
                  { type: "hidden", name: "amount", value: String(capturable) },
                ],
                label: "Capture",
              }),
          },
        ] satisfies RowAction[])
      : []),
    ...(refundable > 0
      ? ([
          {
            label: "Refund payment",
            icon: <BanknoteArrowDown />,
            onSelect: () =>
              void navigate({
                to: "/dashboard/$slug/$id/$page",
                params: { slug: "orders", id, page: "refund" },
              }),
          },
        ] satisfies RowAction[])
      : []),
    ...(order.hasUnfulfilledItems && !order.status.includes("canceled")
      ? ([
          {
            label: "Create fulfillment",
            icon: <PackageCheck />,
            onSelect: () =>
              void navigate({
                to: "/dashboard/$slug/$id/$page",
                params: { slug: "orders", id, page: "fulfill" },
              }),
          },
        ] satisfies RowAction[])
      : []),
    ...(!order.status.includes("canceled")
      ? ([
          {
            label: "Cancel order",
            icon: <Ban />,
            destructive: true,
            onSelect: () =>
              confirm({
                title: "Cancel Order",
                description:
                  "Cancel this order and release its remaining inventory reservations?",
                action: cancelOrderAction,
                fields: [{ type: "hidden", name: "orderId", value: id }],
                label: "Cancel order",
                destructive: true,
              }),
          },
        ] satisfies RowAction[])
      : []),
  ];
  const sidebar = (
    <div className="flex min-w-0 flex-col gap-4">
      <EditCard
        id="order-customer"
        title="Customer"
        fields={[
          { key: "email", label: "Email", displayValue: order.email || "—" },
          {
            key: "customerId",
            label: "Customer ID",
            displayValue: order.customerId || "Guest",
          },
        ]}
      />
      <EditCard
        id="order-addresses"
        title="Addresses"
        fields={[
          {
            key: "shipping",
            label: "Shipping",
            displayValue: addressText(order.shippingAddress),
          },
          {
            key: "billing",
            label: "Billing",
            displayValue: addressText(order.billingAddress),
          },
        ]}
      />
    </div>
  );
  return (
    <PageSplitLayout sidebar={sidebar}>
      <div className="flex min-w-0 flex-col gap-4">
        <EditCard
          id={`order-${id}`}
          title={`Order #${order.displayId}`}
          fields={general}
          onEdit={() =>
            void navigate({
              to: "/dashboard/$slug/$id/edit",
              params: { slug: "orders", id },
            })
          }
          headerActions={
            <div className="flex items-center gap-2">
              <OrderStatusBadge status={order.status} />
              <RowActionsMenu actions={orderActions} label="Order actions" />
            </div>
          }
        />
        <DataTableCard
          label="Items"
          description="Products and quantities captured on this order version."
          columns={itemColumns}
          rows={itemResult?.items ?? []}
          getRowId={(item) => item.id}
          emptyTitle="No items"
          emptyDescription="This draft does not have any line items yet."
          isPending={itemQuery.isPending}
          errorMessage={
            itemQuery.isError
              ? "Failed to load order items"
              : itemQuery.data && !itemQuery.data.success
                ? itemQuery.data.message
                : undefined
          }
          onRetry={() => void itemQuery.refetch()}
          pagination={itemResult?.pagination}
          searchScope="orderItem"
        />
        <DataTableCard
          label="Fulfillments"
          description="Shipment lifecycle and fulfilled quantities for this order."
          columns={fulfillmentColumns}
          rows={fulfillmentResult?.fulfillments ?? []}
          getRowId={(fulfillment) => fulfillment.id}
          emptyTitle="No fulfillments"
          emptyDescription="Create a fulfillment when the order is ready to ship."
          isPending={fulfillmentQuery.isPending}
          errorMessage={
            fulfillmentQuery.isError
              ? "Failed to load fulfillments"
              : fulfillmentQuery.data && !fulfillmentQuery.data.success
                ? fulfillmentQuery.data.message
                : undefined
          }
          onRetry={() => void fulfillmentQuery.refetch()}
          pagination={fulfillmentResult?.pagination}
          searchScope="orderFulfillment"
          rowActions={(fulfillment): RowAction[] =>
            fulfillment.canceledAt || fulfillment.deliveredAt
              ? []
              : fulfillment.shippedAt
                ? [
                    {
                      label: "Mark delivered",
                      icon: <PackageCheck />,
                      onSelect: () =>
                        confirm({
                          title: "Mark Delivered",
                          description:
                            "Confirm that this fulfillment was delivered?",
                          action: deliverOrderFulfillmentAction,
                          fields: [
                            {
                              type: "hidden",
                              name: "fulfillmentId",
                              value: fulfillment.id,
                            },
                          ],
                          label: "Mark delivered",
                        }),
                    },
                  ]
                : [
                    {
                      label: "Mark shipped",
                      icon: <Truck />,
                      onSelect: () =>
                        confirm({
                          title: "Mark Shipped",
                          description:
                            "Confirm that this fulfillment has shipped?",
                          action: shipOrderFulfillmentAction,
                          fields: [
                            {
                              type: "hidden",
                              name: "fulfillmentId",
                              value: fulfillment.id,
                            },
                          ],
                          label: "Mark shipped",
                        }),
                    },
                    {
                      label: "Cancel fulfillment",
                      icon: <Ban />,
                      destructive: true,
                      onSelect: () =>
                        confirm({
                          title: "Cancel Fulfillment",
                          description:
                            "Cancel this fulfillment and restore its stock?",
                          action: cancelOrderFulfillmentAction,
                          fields: [
                            {
                              type: "hidden",
                              name: "fulfillmentId",
                              value: fulfillment.id,
                            },
                          ],
                          label: "Cancel fulfillment",
                          destructive: true,
                        }),
                    },
                  ]
          }
        />
        <MetadataCard
          slug="orders"
          id={id}
          keyCount={Object.keys(order.metadata).length}
        />
      </div>
    </PageSplitLayout>
  );
};
export default OrderDetail;
