import { DialogFooterActions } from "@/components/dialog/dialog-footer-actions";
import { RouteFullscreenSurface } from "@/components/dialog/route-fullscreen-surface";
import { useRouteModalClose } from "@/components/dialog/route-form-modal";
import type { CustomerListItemDTO } from "@/lib/customer/dto/customer.dto";
import type { DashboardSearch } from "@/lib/validations/dashboard-search";
import { DataTableCard, type DataTableColumn } from "@/routes/_backend/dashboard/-components/data-table-card";
import { customerQueries, customerGroupQueries, normalizeCustomerListParams } from "@queries/customer.queries";
import { addCustomersToGroup } from "@/server/customer/customer-groups.serverFn";
import { useQuery, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { useParams, useSearch } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { toast } from "sonner";

export default function CustomerGroupAddCustomers() {
  const { id } = useParams({ strict: false }) as { id: string };
  const search = useSearch({ strict: false }) as DashboardSearch;
  const close = useRouteModalClose();
  const queryClient = useQueryClient();
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [pending, setPending] = useState(false);
  const { data: groupResult } = useSuspenseQuery(customerGroupQueries.detail(id));
  const params = {
    ...normalizeCustomerListParams(search),
    limit: Number(search.limit) || 50,
  };
  const customerQuery = useQuery(customerQueries.list(params));
  const result = customerQuery.data;
  const rows = result?.success ? result.data.customers : [];
  const columns = useMemo<DataTableColumn<CustomerListItemDTO>[]>(
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
        key: "orders",
        header: "Orders",
        className: "w-24 text-right",
        cell: (customer) => customer.orderCount,
      },
    ],
    [],
  );

  const submit = async () => {
    if (selectedIds.size === 0) return;
    setPending(true);
    try {
      const response = await addCustomersToGroup({
        data: { groupId: id, customerIds: [...selectedIds] },
      });
      if (!response.success) {
        toast.error(response.message);
        return;
      }
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: customerGroupQueries.all() }),
        queryClient.invalidateQueries({ queryKey: customerQueries.all() }),
      ]);
      toast.success(response.message);
      close();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to add customers",
      );
    } finally {
      setPending(false);
    }
  };

  return (
    <RouteFullscreenSurface
      label={`Add customers to ${groupResult.success ? groupResult.data.name : "customer group"}`}
      onClose={close}
      bodyClassName="overflow-hidden p-0"
      footer={
        <DialogFooterActions
          isSheet={false}
          isLoading={pending}
          isDisabled={!groupResult.success || selectedIds.size === 0}
          onCancel={close}
          onSubmit={() => void submit()}
          submitLabel={`Add ${selectedIds.size || ""} customers`}
          loadingLabel="Adding..."
        />
      }
    >
      <DataTableCard
        label="Customers"
        hideHeader
        layout="fill"
        className="h-full rounded-none ring-0"
        searchPlaceholder="Search customers"
        sortOptions={[
          { value: "createdAt", label: "Created" },
          { value: "email", label: "Email" },
        ]}
        columns={columns}
        rows={rows}
        getRowId={(customer) => customer.id}
        isPending={customerQuery.isPending}
        errorMessage={result && !result.success ? result.message : null}
        onRetry={() =>
          void queryClient.invalidateQueries({ queryKey: customerQueries.all() })
        }
        emptyTitle="No customers available"
        emptyDescription="No customers match the current search."
        selection={{ selectedIds, onChange: setSelectedIds }}
        pagination={result?.success ? result.data.pagination : undefined}
      />
    </RouteFullscreenSurface>
  );
}
