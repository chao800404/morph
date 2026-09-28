import { Button } from "@/components/ui/button";
import type { CustomerGroupMemberDTO } from "@/lib/customer/dto/customer-group.dto";
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
import { customerGroupQueries, normalizeCustomerGroupMemberListParams } from "@queries/customer.queries";
import { useInfoStore } from "@/routes/_backend/dashboard/-views/features/global-info/use-info-store";
import { useQuery, useSuspenseQuery } from "@tanstack/react-query";
import {
  Link,
  useNavigate,
  useParams,
  useRouter,
  useSearch,
} from "@tanstack/react-router";
import { useCallback, useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import { removeCustomerFromGroupAction } from "./customer-group-actions";

export default function CustomerGroupDetail() {
  const { id } = useParams({ strict: false }) as { id: string };
  const search = useSearch({ strict: false });
  const navigate = useNavigate();
  const router = useRouter();
  const preloadCustomer = useCollectionDetailPreload("customers");
  const { data: result } = useSuspenseQuery(customerGroupQueries.detail(id));
  const group = result.success ? result.data : null;
  const memberParams = normalizeCustomerGroupMemberListParams(id, search);
  const { data: membersResult, isPending } = useQuery(
    customerGroupQueries.members(memberParams),
  );
  const editView = useMemo(
    () =>
      findCollection(getConfig().client.collections.global, "customer-groups")
        ?.edit?.view,
    [],
  );
  const openEdit = useCallback(
    () =>
      void navigate({
        to: "/dashboard/$slug/$id/edit",
        params: { slug: "customer-groups", id },
      }),
    [id, navigate],
  );
  const preloadEdit = useCallback(() => {
    void viewPreloader(editView)?.();
    void router.preloadRoute({
      to: "/dashboard/$slug/$id/edit",
      params: { slug: "customer-groups", id },
    });
  }, [editView, id, router]);
  const { setInfoData, setOpen } = useInfoStore(
    useShallow((state) => ({
      setInfoData: state.setInfoData,
      setOpen: state.setOpen,
    })),
  );
  const columns = useMemo<DataTableColumn<CustomerGroupMemberDTO>[]>(
    () => [
      {
        key: "customer",
        header: "Customer",
        className: "w-64 font-medium",
        cell: (customer) =>
          [customer.firstName, customer.lastName].filter(Boolean).join(" ") ||
          customer.companyName ||
          customer.email ||
          "Unnamed customer",
      },
      {
        key: "email",
        header: "Email",
        className: "text-muted-foreground",
        cell: (customer) => customer.email || "—",
      },
      {
        key: "createdAt",
        header: "Customer since",
        className: "w-40 text-muted-foreground",
        cell: (customer) => new Date(customer.createdAt).toLocaleDateString(),
      },
    ],
    [],
  );
  const members = membersResult?.success ? membersResult.data.customers : [];
  const removeMember = (customer: CustomerGroupMemberDTO) => {
    setInfoData({
      title: "Remove Customer from Group",
      description: `Remove ${customer.email || "this customer"} from "${group?.name ?? "the group"}"?`,
      fields: [
        { type: "hidden", name: "groupId", value: id },
        { type: "hidden", name: "customerId", value: customer.id },
      ],
      action: removeCustomerFromGroupAction,
      confirmLabel: "Remove",
      confirmVariant: "destructive",
      onSuccess: () => void router.invalidate(),
    });
    setOpen(true);
  };

  if (!group) {
    return (
      <CardWrapper label="Customer Group">
        <p className="border-t px-6 py-4 text-sm text-muted-foreground">
          {result.message ?? "Customer group not found"}
        </p>
      </CardWrapper>
    );
  }
  const fields: EditCardField[] = [
    { key: "members", label: "Customers", value: String(group.customerCount) },
    {
      key: "createdAt",
      label: "Created",
      value: group.createdAt,
      displayValue: new Date(group.createdAt).toLocaleDateString(),
    },
  ];
  return (
    <div className="flex flex-col gap-4">
      <EditCard
        id="customer-group-general"
        title={group.name}
        fields={fields}
        onEdit={openEdit}
        onEditPreload={preloadEdit}
      />
      <DataTableCard
        label="Customers"
        description={`${group.customerCount} customers in this group.`}
        headerActions={
          <Button variant="form" size="xs" asChild>
            <Link
              to="/dashboard/$slug/$id/$page"
              params={{ slug: "customer-groups", id, page: "add-customers" }}
            >
              Add customers
            </Link>
          </Button>
        }
        searchPlaceholder="Search group members"
        columns={columns}
        rows={members}
        getRowId={(customer) => customer.id}
        isPending={isPending}
        errorMessage={
          membersResult && !membersResult.success ? membersResult.message : null
        }
        onRetry={() => void router.invalidate()}
        emptyTitle="No customers in this group"
        emptyDescription="Add customers to use this group for pricing and promotion targeting."
        onRowClick={(customer) =>
          void navigate({
            to: "/dashboard/$slug/$id",
            params: { slug: "customers", id: customer.id },
          })
        }
        onRowPreload={(customer) => preloadCustomer(customer.id)}
        rowActions={(customer) => [
          {
            label: "Remove from group",
            icon: deleteActionIcon,
            destructive: true,
            onSelect: () => removeMember(customer),
          },
        ]}
        pagination={
          membersResult?.success ? membersResult.data.pagination : undefined
        }
      />
      <MetadataCard
        slug="customer-groups"
        id={id}
        keyCount={Object.keys(group.metadata ?? {}).length}
      />
    </div>
  );
}
