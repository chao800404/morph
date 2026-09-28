import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { Plus } from "lucide-react";
import type { CustomerDetailDTO } from "@/lib/customer/dto/customer.dto";
import { findCollection } from "@/lib/config/navigation";
import { viewPreloader } from "@/lib/config/lazy-view";
import { CardWrapper } from "@/routes/_backend/dashboard/-components/card-wrapper";
import {
  DataTableCard,
  deleteActionIcon,
  useCollectionDetailPreload,
  type DataTableColumn,
} from "@/routes/_backend/dashboard/-components/data-table-card";
import {
  EditCard,
  type EditCardField,
} from "@/routes/_backend/dashboard/-components/edit-card/edit-card";
import { MetadataCard } from "@/routes/_backend/dashboard/-components/metadata-card/metadata-card";
import { getConfig } from "@/server/get-config";
import { customerQueries } from "@queries/customer.queries";
import { useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import {
  Link,
  useNavigate,
  useParams,
  useRouter,
} from "@tanstack/react-router";
import { useCallback, useMemo } from "react";
import { useInfoStore } from "@/routes/_backend/dashboard/-views/features/global-info/use-info-store";
import { useShallow } from "zustand/react/shallow";
import { deleteCustomerAddressAction } from "./customer-actions";
import { OrderStatusBadge } from "./status-badges";

const customerName = (customer: CustomerDetailDTO) =>
  [customer.firstName, customer.lastName].filter(Boolean).join(" ") ||
  customer.companyName ||
  "Unnamed customer";

const money = (amount: number, currency: string) =>
  new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: currency.toUpperCase(),
  }).format(amount / 100);

export default function CustomerDetail() {
  const { id } = useParams({ strict: false }) as { id: string };
  const navigate = useNavigate();
  const router = useRouter();
  const queryClient = useQueryClient();
  const preloadOrder = useCollectionDetailPreload("orders");
  const { data: result } = useSuspenseQuery(customerQueries.detail(id));
  const customer = result.success ? result.data : null;
  const editView = useMemo(
    () => findCollection(getConfig().client.collections.global, "customers")?.edit?.view,
    [],
  );
  const openEdit = useCallback(
    () =>
      void navigate({
        to: "/dashboard/$slug/$id/edit",
        params: { slug: "customers", id },
      }),
    [id, navigate],
  );
  const preloadEdit = useCallback(() => {
    void viewPreloader(editView)?.();
    void router.preloadRoute({
      to: "/dashboard/$slug/$id/edit",
      params: { slug: "customers", id },
    });
  }, [editView, id, router]);
  const { setInfoData, setOpen } = useInfoStore(
    useShallow((state) => ({
      setInfoData: state.setInfoData,
      setOpen: state.setOpen,
    })),
  );
  const archiveAddress = useCallback(
    (address: CustomerDetailDTO["addresses"][number]) => {
      setInfoData({
        title: "Archive Address",
        description: "This saved address will no longer be available to the customer.",
        fields: [
          { type: "hidden", name: "customerId", value: id },
          { type: "hidden", name: "addressId", value: address.id },
        ],
        action: deleteCustomerAddressAction,
        confirmLabel: "Archive",
        confirmVariant: "destructive",
        onSuccess: () =>
          void queryClient.invalidateQueries({ queryKey: customerQueries.all() }),
      });
      setOpen(true);
    },
    [id, queryClient, setInfoData, setOpen],
  );

  if (!customer) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 text-center">
        <p className="text-sm text-muted-foreground">
          {result.message ?? "Customer not found"}
        </p>
        <Button variant="outline" size="sm" asChild>
          <Link to="/dashboard/$slug" params={{ slug: "customers" }}>
            Back to customers
          </Link>
        </Button>
      </div>
    );
  }

  const fields: EditCardField[] = [
    {
      key: "email",
      label: "Email",
      value: customer.email ?? "",
      displayValue: customer.email || "—",
    },
    {
      key: "phone",
      label: "Phone",
      value: customer.phone ?? "",
      displayValue: customer.phone || "—",
    },
    {
      key: "company",
      label: "Company",
      value: customer.companyName ?? "",
      displayValue: customer.companyName || "—",
    },
    {
      key: "account",
      label: "Account",
      value: customer.hasAccount ? "Registered" : "Guest",
      displayValue: (
        <StatusBadge color={customer.hasAccount ? "green" : "grey"}>
          {customer.hasAccount ? "Registered" : "Guest"}
        </StatusBadge>
      ),
    },
    {
      key: "orders",
      label: "Orders",
      value: String(customer.orderCount),
      displayValue: customer.orderCount,
    },
  ];
  const orderColumns: DataTableColumn<CustomerDetailDTO["recentOrders"][number]>[] = [
    {
      key: "order",
      header: "Order",
      className: "w-32 font-medium",
      cell: (order) => `#${order.displayId}`,
    },
    {
      key: "date",
      header: "Date",
      className: "w-36 text-muted-foreground",
      cell: (order) => new Date(order.createdAt).toLocaleDateString(),
    },
    {
      key: "status",
      header: "Status",
      className: "w-40",
      cell: (order) => <OrderStatusBadge status={order.status} variant="plain" />,
    },
    {
      key: "total",
      header: "Total",
      className: "w-36",
      cell: (order) => money(order.total, order.currencyCode),
    },
  ];

  return (
    <div className="flex flex-col gap-4">
      <EditCard
        id="customer-general"
        title={customerName(customer)}
        fields={fields}
        onEdit={openEdit}
        onEditPreload={preloadEdit}
      />
      <CardWrapper
        id="customer-groups"
        label={
          <span className="flex items-center gap-3">
            Customer groups
            <Badge variant="secondary">{customer.groups.length}</Badge>
          </span>
        }
      >
        <div className="flex flex-wrap gap-2 border-t px-6 py-4">
          {customer.groups.length > 0 ? (
            customer.groups.map((group) => (
              <Badge key={group.id} variant="secondary">
                {group.name}
              </Badge>
            ))
          ) : (
            <p className="text-sm text-muted-foreground">
              This customer is not assigned to a group.
            </p>
          )}
        </div>
      </CardWrapper>
      <CardWrapper
        id="customer-addresses"
        label="Addresses"
        headerButton={
          <Button variant="form" size="xs" asChild>
            <Link
              to="/dashboard/$slug/$id/$page"
              params={{ slug: "customers", id, page: "create-address" }}
            >
              <Plus className="size-3.5" />
              Add address
            </Link>
          </Button>
        }
      >
        {customer.addresses.length > 0 ? (
          <div className="grid gap-3 border-t p-4 sm:grid-cols-2">
            {customer.addresses.map((address) => {
              const name = [address.firstName, address.lastName]
                .filter(Boolean)
                .join(" ");
              const locality = [address.city, address.province, address.postalCode]
                .filter(Boolean)
                .join(", ");
              return (
                <div
                  key={address.id}
                  className="rounded-md border bg-background px-4 py-3 text-sm"
                >
                  <div className="mb-2 flex flex-wrap items-center gap-2 font-medium text-foreground">
                    <span>{address.addressName || name || "Address"}</span>
                    {address.isDefaultShipping ? (
                      <Badge variant="outline">Default shipping</Badge>
                    ) : null}
                    {address.isDefaultBilling ? (
                      <Badge variant="outline">Default billing</Badge>
                    ) : null}
                    <div className="ml-auto flex items-center gap-1">
                      <Button variant="ghost" size="xs" asChild>
                        <Link
                          to="/dashboard/$slug/$id/$page/$childId"
                          params={{
                            slug: "customers",
                            id,
                            page: "edit-address",
                            childId: address.id,
                          }}
                        >
                          Edit
                        </Link>
                      </Button>
                      <Button
                        variant="ghost"
                        size="xs"
                        onClick={() => archiveAddress(address)}
                      >
                        {deleteActionIcon}
                        Archive
                      </Button>
                    </div>
                  </div>
                  <div className="space-y-1 text-muted-foreground">
                    {name ? <p>{name}</p> : null}
                    {address.company ? <p>{address.company}</p> : null}
                    {address.address1 ? <p>{address.address1}</p> : null}
                    {address.address2 ? <p>{address.address2}</p> : null}
                    {locality ? <p>{locality}</p> : null}
                    {address.countryCode ? <p>{address.countryCode.toUpperCase()}</p> : null}
                    {address.phone ? <p>{address.phone}</p> : null}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="border-t px-6 py-4 text-sm text-muted-foreground">
            No addresses saved for this customer.
          </p>
        )}
      </CardWrapper>
      <DataTableCard
        label="Recent Orders"
        description={`${customer.orderCount} total ${customer.orderCount === 1 ? "order" : "orders"} for this customer.`}
        columns={orderColumns}
        rows={customer.recentOrders}
        getRowId={(order) => order.id}
        emptyTitle="No orders yet"
        emptyDescription="Orders placed by this customer appear here."
        onRowClick={(order) =>
          void navigate({
            to: "/dashboard/$slug/$id",
            params: { slug: "orders", id: order.id },
          })
        }
        onRowPreload={(order) => preloadOrder(order.id)}
      />
      <MetadataCard
        slug="customers"
        id={id}
        keyCount={Object.keys(customer.metadata ?? {}).length}
      />
    </div>
  );
}
