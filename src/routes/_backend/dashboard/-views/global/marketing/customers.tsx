import type { CustomerListItemDTO } from "@/lib/customer/dto/customer.dto";
import type { DashboardSearch } from "@/lib/validations/dashboard-search";
import {
  CollectionCreateButton,
  DataTableCard,
  useCollectionEditAction,
  useCollectionDetailPreload,
  type DataTableColumn,
} from "@/routes/_backend/dashboard/-components/data-table-card";
import { useInfoStore } from "@/routes/_backend/dashboard/-views/features/global-info/use-info-store";
import {
  customerQueries,
  normalizeCustomerListParams,
} from "@queries/customer.queries";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { useCallback, useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import { deleteActionIcon } from "@/routes/_backend/dashboard/-components/data-table-card";
import { deleteCustomerAction } from "./customer-actions";

const Customers = () => {
  const search = useSearch({ strict: false }) as DashboardSearch;
  const navigate = useNavigate();
  const preloadDetail = useCollectionDetailPreload("customers");
  const editAction = useCollectionEditAction("customers");
  const queryClient = useQueryClient();
  const params = normalizeCustomerListParams(search);
  const { data: result, isPending } = useQuery(customerQueries.list(params));
  const { setInfoData, setOpen: setInfoOpen } = useInfoStore(
    useShallow((state) => ({
      setInfoData: state.setInfoData,
      setOpen: state.setOpen,
    })),
  );
  const invalidate = useCallback(
    () => void queryClient.invalidateQueries({ queryKey: customerQueries.all() }),
    [queryClient],
  );
  const handleArchive = useCallback(
    (customer: CustomerListItemDTO) => {
      setInfoData({
        title: "Archive Customer",
        description: `Archive ${customer.email || customerName(customer)}? Their historical orders will remain available.`,
        fields: [
          {
            type: "hidden",
            name: "customerIds",
            value: JSON.stringify([customer.id]),
          },
        ],
        action: deleteCustomerAction,
        confirmLabel: "Archive",
        confirmVariant: "destructive",
        onSuccess: invalidate,
      });
      setInfoOpen(true);
    },
    [invalidate, setInfoData, setInfoOpen],
  );
  const columns = useMemo<DataTableColumn<CustomerListItemDTO>[]>(
    () => [
      {
        key: "customer",
        header: "Customer",
        className: "w-64 font-medium",
        cell: (customer) => customerName(customer),
      },
      {
        key: "email",
        header: "Email",
        className: "text-muted-foreground",
        cell: (customer) => customer.email || "—",
      },
      {
        key: "orders",
        header: "Orders",
        className: "w-24 text-right",
        cell: (customer) => customer.orderCount,
      },
      {
        key: "createdAt",
        header: "Created",
        className: "w-36 text-muted-foreground",
        cell: (customer) => new Date(customer.createdAt).toLocaleDateString(),
      },
    ],
    [],
  );
  const customers = result?.success ? result.data.customers : [];

  return (
    <DataTableCard
      label="Customers"
      description="Manage customer profiles, addresses, groups, and order history."
      headerActions={<CollectionCreateButton slug="customers" />}
      searchPlaceholder="Search customers"
      sortOptions={[
        { value: "createdAt", label: "Created" },
        { value: "email", label: "Email" },
      ]}
      columns={columns}
      rows={customers}
      getRowId={(customer) => customer.id}
      isPending={isPending}
      errorMessage={result && !result.success ? result.message : null}
      onRetry={invalidate}
      emptyTitle="No customers yet"
      emptyDescription="Customers created in the storefront or by your team appear here."
      onRowClick={(customer) =>
        void navigate({
          to: "/dashboard/$slug/$id",
          params: { slug: "customers", id: customer.id },
        })
      }
      onRowPreload={(customer) => preloadDetail(customer.id)}
      rowActions={(customer) => [
        ...editAction(customer.id),
        {
          label: "Archive",
          icon: deleteActionIcon,
          destructive: true,
          onSelect: () => handleArchive(customer),
        },
      ]}
      pagination={result?.success ? result.data.pagination : undefined}
    />
  );
};

const customerName = (
  customer: Pick<CustomerListItemDTO, "firstName" | "lastName" | "companyName">,
) =>
  [customer.firstName, customer.lastName].filter(Boolean).join(" ") ||
  customer.companyName ||
  "Unnamed customer";

export default Customers;
