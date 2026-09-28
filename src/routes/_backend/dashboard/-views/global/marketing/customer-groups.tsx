import type { CustomerGroupListItemDTO } from "@/lib/customer/dto/customer-group.dto";
import type { DashboardSearch } from "@/lib/validations/dashboard-search";
import {
  CollectionCreateButton,
  DataTableCard,
  deleteActionIcon,
  useCollectionDetailPreload,
  useCollectionEditAction,
  type DataTableColumn,
} from "@/routes/_backend/dashboard/-components/data-table-card";
import { useInfoStore } from "@/routes/_backend/dashboard/-views/features/global-info/use-info-store";
import {
  customerGroupQueries,
  normalizeCustomerGroupListParams,
} from "@queries/customer.queries";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { useCallback, useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import { deleteCustomerGroupAction } from "./customer-group-actions";

export default function CustomerGroups() {
  const search = useSearch({ strict: false }) as DashboardSearch;
  const params = normalizeCustomerGroupListParams(search);
  const { data: result, isPending } = useQuery(customerGroupQueries.list(params));
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const preloadDetail = useCollectionDetailPreload("customer-groups");
  const editAction = useCollectionEditAction("customer-groups");
  const { setInfoData, setOpen } = useInfoStore(
    useShallow((state) => ({
      setInfoData: state.setInfoData,
      setOpen: state.setOpen,
    })),
  );
  const invalidate = useCallback(
    () => void queryClient.invalidateQueries({ queryKey: customerGroupQueries.all() }),
    [queryClient],
  );
  const columns = useMemo<DataTableColumn<CustomerGroupListItemDTO>[]>(
    () => [
      {
        key: "name",
        header: "Name",
        className: "w-64 font-medium",
        cell: (group) => group.name,
      },
      {
        key: "customers",
        header: "Customers",
        className: "w-32",
        cell: (group) => group.customerCount,
      },
      {
        key: "createdAt",
        header: "Created",
        className: "w-36 text-muted-foreground",
        cell: (group) => new Date(group.createdAt).toLocaleDateString(),
      },
    ],
    [],
  );
  const archive = (group: CustomerGroupListItemDTO) => {
    setInfoData({
      title: "Archive Customer Group",
      description: `Archive "${group.name}" and remove its active customer memberships?`,
      fields: [{ type: "hidden", name: "groupId", value: group.id }],
      action: deleteCustomerGroupAction,
      confirmLabel: "Archive",
      confirmVariant: "destructive",
      onSuccess: invalidate,
    });
    setOpen(true);
  };

  return (
    <DataTableCard
      label="Customer Groups"
      description="Segment customers for targeted pricing and promotions."
      headerActions={<CollectionCreateButton slug="customer-groups" />}
      searchPlaceholder="Search customer groups"
      sortOptions={[
        { value: "createdAt", label: "Created" },
        { value: "name", label: "Name" },
      ]}
      columns={columns}
      rows={result?.success ? result.data.groups : []}
      getRowId={(group) => group.id}
      isPending={isPending}
      errorMessage={result && !result.success ? result.message : null}
      onRetry={invalidate}
      emptyTitle="No customer groups yet"
      emptyDescription="Create a group to segment customers for promotions or pricing."
      onRowClick={(group) =>
        void navigate({
          to: "/dashboard/$slug/$id",
          params: { slug: "customer-groups", id: group.id },
        })
      }
      onRowPreload={(group) => preloadDetail(group.id)}
      rowActions={(group) => [
        ...editAction(group.id),
        {
          label: "Archive",
          icon: deleteActionIcon,
          destructive: true,
          onSelect: () => archive(group),
        },
      ]}
      pagination={result?.success ? result.data.pagination : undefined}
    />
  );
}
