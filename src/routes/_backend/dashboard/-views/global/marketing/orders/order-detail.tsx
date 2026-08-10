import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import type { OrderDetailDTO } from "@/lib/commerce/dto";
import {
  DataTableCard,
  type DataTableColumn,
} from "@/routes/_backend/dashboard/-components/data-table-card";
import {
  EditCard,
  type EditCardField,
} from "@/routes/_backend/dashboard/-components/edit-card/edit-card";
import { orderQueries } from "@queries/marketing.queries";
import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { useMemo } from "react";
import { OrderStatusBadge } from "../status-badges";
import { PageSplitLayout } from "@/routes/_backend/dashboard/-components/layout/page-split-layout";

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
  const navigate = useNavigate();
  const { data: result, isPending } = useQuery(orderQueries.detail(id));
  const order = result?.success ? result.data : null;
  const itemColumns = useMemo<
    DataTableColumn<OrderDetailDTO["items"][number]>[]
  >(
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
  if (isPending)
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner />
      </div>
    );
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
          headerActions={<OrderStatusBadge status={order.status} />}
        />
        <DataTableCard
          label="Items"
          description="Products and quantities captured on this order version."
          columns={itemColumns}
          rows={order.items}
          getRowId={(item) => item.id}
          emptyTitle="No items"
          emptyDescription="This draft does not have any line items yet."
        />
      </div>
    </PageSplitLayout>
  );
};
export default OrderDetail;
