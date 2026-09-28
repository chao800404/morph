import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { OrderDetailSkeleton } from "@/routes/_backend/dashboard/-components/loading/collection-page-skeletons";
import type { OrderNotificationDTO } from "@/lib/notification/dto/notification.dto";
import type {
  OrderDetailDTO,
  OrderClaimDTO,
  OrderExchangeDTO,
  OrderFulfillmentDTO,
  OrderItemDTO,
  OrderReturnDTO,
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
  normalizeOrderNotificationListParams,
  normalizeOrderReturnListParams,
  orderQueries,
} from "@queries/marketing.queries";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useQueryClient } from "@tanstack/react-query";
import {
  Link,
  useNavigate,
  useParams,
  useSearch,
} from "@tanstack/react-router";
import { useCallback, useMemo } from "react";
import { OrderReturnStatusBadge, OrderStatusBadge } from "../status-badges";
import { PageSplitLayout } from "@/routes/_backend/dashboard/-components/layout/page-split-layout";
import { MetadataCard } from "@/routes/_backend/dashboard/-components/metadata-card/metadata-card";
import {
  RowActionsMenu,
  type RowAction,
} from "@/routes/_backend/dashboard/-components/data-table-card/row-actions-menu";
import { useInfoStore } from "@views/features/global-info/use-info-store";
import { useShallow } from "zustand/react/shallow";
import { toast } from "sonner";
import { retryOrderNotification } from "@/server/marketing/notifications.serverFn";
import {
  cancelOrderAction,
  cancelOrderEditAction,
  cancelOrderFulfillmentAction,
  captureOrderPaymentAction,
  confirmOrderEditAction,
  convertDraftOrderAction,
  deliverOrderFulfillmentAction,
  cancelOrderReturnAction,
  cancelOrderExchangeAction,
  shipOrderFulfillmentAction,
} from "./order-workflow-actions";
import {
  Ban,
  ArrowRight,
  BanknoteArrowDown,
  Check,
  PackageCheck,
  PackageOpen,
  Plus,
  RotateCw,
  Truck,
  X,
} from "lucide-react";

const money = (amount: number, currency: string) =>
  new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: currency.toUpperCase(),
  }).format(amount / 100);
const externalHttpUrl = (value: string) => {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:"
      ? url.toString()
      : null;
  } catch {
    return null;
  }
};
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
  const orderEditQuery = useQuery({
    ...orderQueries.editRequest(id),
    enabled: result?.success === true && !result.data.isDraftOrder,
  });
  const itemQuery = useQuery(
    orderQueries.items(normalizeOrderItemListParams(id, search)),
  );
  const fulfillmentQuery = useQuery(
    orderQueries.fulfillments(normalizeOrderFulfillmentListParams(id, search)),
  );
  const returnQuery = useQuery(
    orderQueries.returns(normalizeOrderReturnListParams(id, search)),
  );
  const returnableQuery = useQuery(orderQueries.returnableItems(id));
  const claimsQuery = useQuery(orderQueries.claims(id));
  const exchangeQuery = useQuery(orderQueries.exchanges(id));
  const notificationQuery = useQuery(
    orderQueries.notifications(
      normalizeOrderNotificationListParams(id, search),
    ),
  );
  const retryNotificationMutation = useMutation({
    mutationFn: (notificationId: string) =>
      retryOrderNotification({ data: { orderId: id, notificationId } }),
    onSuccess: async (response) => {
      await client.invalidateQueries({
        queryKey: [...orderQueries.all(), "notifications"],
      });
      if (!response.success) {
        toast.error(response.message, { position: "top-center" });
        return;
      }
      toast.success(response.message, { position: "top-center" });
    },
    onError: async () => {
      await client.invalidateQueries({
        queryKey: [...orderQueries.all(), "notifications"],
      });
      toast.error("Failed to retry the order confirmation email", {
        position: "top-center",
      });
    },
  });
  const order = result?.success ? result.data : null;
  const itemResult = itemQuery.data?.success ? itemQuery.data.data : null;
  const fulfillmentResult = fulfillmentQuery.data?.success
    ? fulfillmentQuery.data.data
    : null;
  const returnResult = returnQuery.data?.success ? returnQuery.data.data : null;
  const claims = claimsQuery.data?.success ? claimsQuery.data.data.claims : [];
  const exchanges = exchangeQuery.data?.success
    ? exchangeQuery.data.data.exchanges
    : [];
  const notificationResult = notificationQuery.data?.success
    ? notificationQuery.data.data
    : null;
  const returnableItems = returnableQuery.data?.success
    ? returnableQuery.data.data.items
    : [];
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
        key: "labels",
        header: "Tracking",
        className: "min-w-48",
        cell: (fulfillment) => (
          <div className="flex flex-col gap-1">
            {fulfillment.labels.map((label) => {
              const trackingUrl = externalHttpUrl(label.trackingUrl);
              const labelUrl = externalHttpUrl(label.labelUrl);
              return (
                <div key={label.id} className="flex flex-wrap gap-x-3 gap-y-1">
                  {trackingUrl ? (
                    <a
                      href={trackingUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label={`Track package ${label.trackingNumber}`}
                      className="break-all text-primary underline-offset-4 hover:underline"
                    >
                      {label.trackingNumber}
                    </a>
                  ) : (
                    <span className="break-all">{label.trackingNumber}</span>
                  )}
                  {labelUrl ? (
                    <a
                      href={labelUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-primary underline-offset-4 hover:underline"
                    >
                      Shipping label
                    </a>
                  ) : null}
                </div>
              );
            })}
            {fulfillment.labels.length === 0 ? "—" : null}
          </div>
        ),
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
  const returnColumns = useMemo<DataTableColumn<OrderReturnDTO>[]>(
    () => [
      {
        key: "displayId",
        header: "Return",
        className: "w-28 font-medium",
        cell: (orderReturn) => `#${orderReturn.displayId}`,
      },
      {
        key: "items",
        header: "Items",
        cell: (orderReturn) =>
          orderReturn.items
            .map(
              (item) =>
                `${item.title} × ${item.receivedQuantity}/${item.quantity}`,
            )
            .join(", "),
      },
      {
        key: "status",
        header: "Status",
        className: "w-40",
        cell: (orderReturn) => (
          <OrderReturnStatusBadge status={orderReturn.status} />
        ),
      },
      {
        key: "requestedAt",
        header: "Requested",
        className: "w-48 text-muted-foreground",
        cell: (orderReturn) =>
          orderReturn.requestedAt
            ? new Date(orderReturn.requestedAt).toLocaleString()
            : "—",
      },
    ],
    [],
  );
  const claimColumns = useMemo<DataTableColumn<OrderClaimDTO>[]>(
    () => [
      {
        key: "displayId",
        header: "Claim",
        className: "w-28 font-medium",
        cell: (claim) => `#${claim.displayId}`,
      },
      {
        key: "items",
        header: "Items",
        cell: (claim) =>
          claim.items
            .map(
              (item) =>
                `${item.isAdditionalItem ? "Replacement" : "Returned"}: ${item.title} × ${item.quantity}`,
            )
            .join(", "),
      },
      {
        key: "refundAmount",
        header: "Refund due",
        className: "w-40",
        cell: (claim) =>
          claim.type === "refund" && claim.refundAmount !== null
            ? money(claim.refundAmount, order?.currencyCode ?? "usd")
            : "—",
      },
      {
        key: "shipping",
        header: "Shipping",
        className: "w-60",
        cell: (claim) =>
          [
            claim.returnShipping
              ? `Return: ${claim.returnShipping.name} (${money(claim.returnShipping.amount, order?.currencyCode ?? "usd")})`
              : null,
            claim.outboundShipping
              ? `Outbound: ${claim.outboundShipping.name} (${money(claim.outboundShipping.amount, order?.currencyCode ?? "usd")})`
              : null,
          ]
            .filter(Boolean)
            .join(" · ") || "—",
      },
      {
        key: "status",
        header: "Status",
        className: "w-32",
        cell: (claim) =>
          claim.canceledAt
            ? "Canceled"
            : claim.type === "refund"
              ? "Refund due · payment not processed"
              : "Confirmed",
      },
      {
        key: "createdAt",
        header: "Created",
        className: "w-48 text-muted-foreground",
        cell: (claim) => new Date(claim.createdAt).toLocaleString(),
      },
    ],
    [],
  );
  const exchangeColumns = useMemo<DataTableColumn<OrderExchangeDTO>[]>(
    () => [
      {
        key: "displayId",
        header: "Exchange",
        className: "w-28 font-medium",
        cell: (exchange) => `#${exchange.displayId}`,
      },
      {
        key: "items",
        header: "Items",
        cell: (exchange) =>
          [
            ...exchange.inboundItems.map(
              (item) => `Return: ${item.title} × ${item.quantity}`,
            ),
            ...exchange.items.map(
              (item) => `Send: ${item.title} × ${item.quantity}`,
            ),
          ].join(", "),
      },
      {
        key: "differenceDue",
        header: "Difference due",
        className: "w-40",
        cell: (exchange) =>
          money(exchange.differenceDue, order?.currencyCode ?? "usd"),
      },
      {
        key: "shipping",
        header: "Shipping",
        className: "w-60",
        cell: (exchange) =>
          [
            exchange.returnShipping
              ? `Return: ${exchange.returnShipping.name} (${money(exchange.returnShipping.amount, order?.currencyCode ?? "usd")})`
              : null,
            exchange.outboundShipping
              ? `Outbound: ${exchange.outboundShipping.name} (${money(exchange.outboundShipping.amount, order?.currencyCode ?? "usd")})`
              : null,
          ]
            .filter(Boolean)
            .join(" · ") || "—",
      },
      {
        key: "locationName",
        header: "Stock location",
        className: "w-40 text-muted-foreground",
        cell: (exchange) => exchange.locationName || "—",
      },
      {
        key: "status",
        header: "Status",
        className: "w-36",
        cell: (exchange) =>
          exchange.canceledAt
            ? "Canceled"
            : exchange.returnStatus === "received"
              ? "Return received"
              : exchange.returnStatus === "partially_received"
                ? "Partially received"
                : "Awaiting return",
      },
      {
        key: "createdAt",
        header: "Created",
        className: "w-48 text-muted-foreground",
        cell: (exchange) => new Date(exchange.createdAt).toLocaleString(),
      },
    ],
    [order?.currencyCode],
  );
  const notificationColumns = useMemo<DataTableColumn<OrderNotificationDTO>[]>(
    () => [
      {
        key: "recipient",
        header: "Recipient",
        className: "min-w-52 font-medium",
        cell: (notification) => notification.recipient,
      },
      {
        key: "triggerType",
        header: "Event",
        className: "min-w-48 text-muted-foreground",
        cell: (notification) =>
          notification.triggerType ?? notification.template ?? "—",
      },
      {
        key: "status",
        header: "Delivery",
        className: "w-32",
        cell: (notification) => (
          <Badge
            variant={
              notification.status === "success"
                ? "success"
                : notification.status === "failure"
                  ? "destructive"
                  : "neutral"
            }
          >
            {notification.status === "success"
              ? "Sent"
              : notification.status === "failure"
                ? "Failed"
                : "Pending"}
          </Badge>
        ),
      },
      {
        key: "createdAt",
        header: "Created",
        className: "w-48 text-muted-foreground",
        cell: (notification) =>
          new Date(notification.createdAt).toLocaleString(),
      },
      {
        key: "externalId",
        header: "Provider reference",
        className: "max-w-56 truncate text-muted-foreground",
        cell: (notification) => notification.externalId ?? "—",
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
  const requestedEdit = orderEditQuery.data;
  const requestedChanges = requestedEdit?.actions.flatMap((action) => {
    if (!action.details || typeof action.details !== "object") return [];
    const details = action.details;
    return [
      ...(typeof details.previousOrderTotal === "number" &&
      typeof details.proposedOrderTotal === "number"
        ? [
            `Order total: ${money(details.previousOrderTotal, order.currencyCode)} → ${money(details.proposedOrderTotal, order.currencyCode)}`,
          ]
        : []),
      ...(typeof details.title === "string" &&
      typeof details.previousQuantity === "number" &&
      action.action === "ITEM_UPDATE" &&
      typeof details.quantity === "number"
        ? [
            `Item quantity: ${details.title} · ${details.previousQuantity} → ${details.quantity}`,
          ]
        : []),
      ...(typeof details.title === "string" && action.action === "ITEM_REMOVE"
        ? [
            `Remove item: ${details.title} · quantity ${String(details.previousQuantity ?? "—")}`,
          ]
        : []),
      ...(typeof details.email === "string"
        ? [`Customer email: ${details.email || "—"}`]
        : []),
      ...(typeof details.noNotification === "boolean"
        ? [
            `Customer notifications: ${details.noNotification ? "disabled" : "enabled"}`,
          ]
        : []),
    ];
  });
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
    ...(order.isDraftOrder
      ? ([
          {
            label: "Convert to order",
            icon: <ArrowRight />,
            onSelect: () =>
              confirm({
                title: "Convert Draft Order",
                description:
                  "This action cannot be undone. You can cancel the order after conversion.",
                action: convertDraftOrderAction,
                fields: [{ type: "hidden", name: "orderId", value: id }],
                label: "Convert to order",
              }),
          },
        ] satisfies RowAction[])
      : []),
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
    ...(returnableItems.length && !order.status.includes("canceled")
      ? ([
          {
            label: "Create return",
            icon: <Plus />,
            onSelect: () =>
              void navigate({
                to: "/dashboard/$slug/$id/$page",
                params: { slug: "orders", id, page: "return" },
              }),
          },
        ] satisfies RowAction[])
      : []),
    ...(returnableItems.length && !order.status.includes("canceled")
      ? ([
          {
            label: "Create exchange",
            icon: <PackageOpen />,
            onSelect: () =>
              void navigate({
                to: "/dashboard/$slug/$id/$page",
                params: { slug: "orders", id, page: "exchange" },
              }),
          },
        ] satisfies RowAction[])
      : []),
    ...(returnableItems.length && !order.status.includes("canceled")
      ? ([
          {
            label: "Create replacement claim",
            icon: <PackageCheck />,
            onSelect: () =>
              void navigate({
                to: "/dashboard/$slug/$id/$page",
                params: { slug: "orders", id, page: "claim" },
              }),
          },
          {
            label: "Create refund claim",
            icon: <PackageCheck />,
            onSelect: () =>
              void navigate({
                to: "/dashboard/$slug/$id/$page",
                params: { slug: "orders", id, page: "refund-claim" },
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
      <EditCard
        id="order-credit-lines"
        title="Credits"
        description="Store credit and other credits applied to this order."
        fields={[
          {
            key: "total",
            label: "Total applied",
            displayValue: money(
              order.creditLines.reduce((sum, line) => sum + line.amount, 0),
              order.currencyCode,
            ),
          },
          ...order.creditLines.map((line) => ({
            key: line.id,
            label:
              line.reference === "gift_card_account"
                ? "Gift card"
                : line.reference === "store_credit_account"
                  ? "Store credit"
                  : (line.reference ?? "Credit"),
            displayValue: money(line.amount, order.currencyCode),
          })),
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
        {requestedEdit ? (
          <Card className="gap-4 py-4">
            <CardHeader className="flex flex-wrap items-start justify-between gap-3">
              <div className="space-y-1">
                <CardTitle>Order edit awaiting customer review</CardTitle>
                <CardDescription>
                  Requested{" "}
                  {new Date(
                    requestedEdit.requested_at ?? requestedEdit.updated_at,
                  ).toLocaleString()}
                </CardDescription>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    confirm({
                      title: "Cancel Order Edit",
                      description:
                        "Cancel this pending request? The order will stay unchanged.",
                      action: cancelOrderEditAction,
                      fields: [{ type: "hidden", name: "orderId", value: id }],
                      label: "Cancel request",
                      destructive: true,
                    })
                  }
                >
                  <X />
                  Cancel request
                </Button>
                <Button
                  size="sm"
                  onClick={() =>
                    confirm({
                      title: "Force Confirm Order Edit",
                      description:
                        "Apply the requested changes now without waiting for the customer?",
                      action: confirmOrderEditAction,
                      fields: [{ type: "hidden", name: "orderId", value: id }],
                      label: "Force confirm",
                    })
                  }
                >
                  <Check />
                  Force confirm
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-1 border-t-0 pt-0 text-sm">
              {requestedChanges?.length ? (
                requestedChanges.map((change) => <p key={change}>{change}</p>)
              ) : (
                <p className="text-muted-foreground">No change details</p>
              )}
            </CardContent>
          </Card>
        ) : null}
        {orderEditQuery.isError ? (
          <p className="text-sm text-destructive" role="alert">
            The pending order edit could not be loaded.
          </p>
        ) : null}
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
        <DataTableCard
          label="Returns"
          description="Returned items, receipt quantities, and their condition."
          columns={returnColumns}
          rows={returnResult?.returns ?? []}
          getRowId={(orderReturn) => orderReturn.id}
          emptyTitle="No returns"
          emptyDescription="Create a return after an order item has been delivered."
          isPending={returnQuery.isPending}
          errorMessage={
            returnQuery.isError
              ? "Failed to load returns"
              : returnQuery.data && !returnQuery.data.success
                ? returnQuery.data.message
                : undefined
          }
          onRetry={() => void returnQuery.refetch()}
          pagination={returnResult?.pagination}
          searchScope="orderReturn"
          rowActions={(orderReturn): RowAction[] => [
            ...(orderReturn.status === "requested" ||
            orderReturn.status === "partially_received"
              ? [
                  {
                    label: "Receive return",
                    icon: <PackageOpen />,
                    onSelect: () =>
                      void navigate({
                        to: "/dashboard/$slug/$id/$page",
                        params: { slug: "orders", id, page: "receive-return" },
                        search: (previous) => ({
                          ...previous,
                          returnId: orderReturn.id,
                        }),
                      }),
                  },
                  ...(orderReturn.claimId || orderReturn.exchangeId
                    ? []
                    : [
                        {
                          label: "Cancel return",
                          icon: <Ban />,
                          destructive: true,
                          onSelect: () =>
                            confirm({
                              title: "Cancel Return",
                              description:
                                "Cancel the outstanding quantities in this return? Items already received stay recorded.",
                              action: cancelOrderReturnAction,
                              fields: [
                                {
                                  type: "hidden",
                                  name: "returnId",
                                  value: orderReturn.id,
                                },
                              ],
                              label: "Cancel return",
                              destructive: true,
                            }),
                        },
                      ]),
                ]
              : []),
          ]}
        />
        <DataTableCard
          label="Claims"
          description="Refund and replacement claims with their linked returns. Refund claims record the amount due but do not process a payment."
          columns={claimColumns}
          rows={claims}
          getRowId={(claim) => claim.id}
          emptyTitle="No claims"
          emptyDescription="Create a refund or replacement claim for faulty or incorrect delivered items."
          isPending={claimsQuery.isPending}
          errorMessage={
            claimsQuery.isError
              ? "Failed to load claims"
              : claimsQuery.data && !claimsQuery.data.success
                ? claimsQuery.data.message
                : undefined
          }
          onRetry={() => void claimsQuery.refetch()}
        />
        <DataTableCard
          label="Exchanges"
          description="Returned items, replacement items, inventory reservations, and any balance due."
          columns={exchangeColumns}
          rows={exchanges}
          getRowId={(exchange) => exchange.id}
          emptyTitle="No exchanges"
          emptyDescription="Create an exchange for delivered items when a customer wants a replacement."
          isPending={exchangeQuery.isPending}
          errorMessage={
            exchangeQuery.isError
              ? "Failed to load exchanges"
              : exchangeQuery.data && !exchangeQuery.data.success
                ? exchangeQuery.data.message
                : undefined
          }
          onRetry={() => void exchangeQuery.refetch()}
          rowActions={(exchange): RowAction[] =>
            !exchange.canceledAt &&
            exchange.returnStatus !== "received" &&
            exchange.returnStatus !== "partially_received"
              ? [
                  {
                    label: "Cancel exchange",
                    icon: <Ban />,
                    destructive: true,
                    onSelect: () =>
                      confirm({
                        title: "Cancel Exchange",
                        description:
                          "Cancel this exchange and release its replacement inventory? This is only allowed before an outbound item is fulfilled or an inbound item is received.",
                        action: cancelOrderExchangeAction,
                        fields: [
                          {
                            type: "hidden",
                            name: "exchangeId",
                            value: exchange.id,
                          },
                        ],
                        label: "Cancel exchange",
                        destructive: true,
                      }),
                  },
                ]
              : []
          }
        />
        <DataTableCard
          label="Notifications"
          description="Email delivery attempts related to this order."
          columns={notificationColumns}
          rows={notificationResult?.notifications ?? []}
          getRowId={(notification) => notification.id}
          emptyTitle="No notifications"
          emptyDescription="Order-related emails will appear here after they are sent."
          isPending={notificationQuery.isPending}
          errorMessage={
            notificationQuery.isError
              ? "Failed to load notifications"
              : notificationQuery.data && !notificationQuery.data.success
                ? notificationQuery.data.message
                : undefined
          }
          onRetry={() => void notificationQuery.refetch()}
          pagination={notificationResult?.pagination}
          searchScope="orderNotification"
          rowActions={(notification): RowAction[] =>
            notification.canRetry
              ? [
                  {
                    label: "Retry delivery",
                    icon: <RotateCw className="size-4" />,
                    disabled: retryNotificationMutation.isPending,
                    onSelect: () =>
                      retryNotificationMutation.mutate(notification.id),
                  },
                ]
              : []
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
