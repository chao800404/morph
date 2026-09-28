import type { StoreCreditAccountDTO } from "@/lib/store-credit/dto/store-credit.dto";
import type { DashboardSearch } from "@/lib/validations/dashboard-search";
import { Badge } from "@/components/ui/badge";
import {
  CollectionCreateButton,
  DataTableCard,
  useCollectionDetailPreload,
  type DataTableColumn,
  type DataTableFilterDefinition,
} from "@/routes/_backend/dashboard/-components/data-table-card";
import {
  normalizeStoreCreditListParams,
  storeCreditQueries,
} from "@queries/store-credit.queries";
import { formatMoney, findCurrency } from "@/lib/currency/catalog";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { useCallback, useMemo } from "react";

export default function StoreCredits() {
  const search = useSearch({ strict: false }) as DashboardSearch;
  const params = normalizeStoreCreditListParams(search);
  const { data: result, isPending } = useQuery(storeCreditQueries.list(params));
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const preloadDetail = useCollectionDetailPreload("store-credits");
  const invalidate = useCallback(
    () =>
      void queryClient.invalidateQueries({
        queryKey: storeCreditQueries.all(),
      }),
    [queryClient],
  );

  const columns = useMemo<DataTableColumn<StoreCreditAccountDTO>[]>(
    () => [
      {
        key: "customer",
        header: "Customer",
        className: "w-64 font-medium",
        cell: (row) => row.customerName || row.customerEmail || "Unclaimed",
      },
      {
        key: "balance",
        header: "Balance",
        className: "w-36 text-right",
        cell: (row) => {
          const currency = findCurrency(row.currencyCode);
          return currency
            ? formatMoney(row.balance, currency)
            : `${row.balance} ${row.currencyCode.toUpperCase()}`;
        },
      },
      {
        key: "currency",
        header: "Currency",
        className: "w-24",
        cell: (row) => row.currencyCode.toUpperCase(),
      },
      {
        key: "status",
        header: "Status",
        className: "w-28",
        cell: (row) => (
          <Badge variant={row.status === "active" ? "success" : "neutral"}>
            {row.status === "active" ? "Active" : "Disabled"}
          </Badge>
        ),
      },
      {
        key: "createdAt",
        header: "Created",
        className: "w-36 text-muted-foreground",
        cell: (row) => new Date(row.createdAt).toLocaleDateString(),
      },
    ],
    [],
  );

  const filters = useMemo<DataTableFilterDefinition[]>(
    () => [
      {
        key: "status",
        label: "Status",
        options: [
          { value: "active", label: "Active" },
          { value: "disabled", label: "Disabled" },
        ],
        values: search.storeCreditStatus ? [search.storeCreditStatus] : [],
        multiple: false,
        onValuesChange: (values) =>
          void navigate({
            to: ".",
            search: (previous: DashboardSearch) => ({
              ...previous,
              storeCreditStatus: values.at(-1) as
                DashboardSearch["storeCreditStatus"] | undefined,
              page: undefined,
            }),
            replace: true,
          }),
      },
    ],
    [navigate, search.storeCreditStatus],
  );

  const rows = result?.success ? result.data.accounts : [];
  return (
    <DataTableCard
      label="Store Credits"
      description="Issue customer credit, review balances, and track every adjustment."
      headerActions={<CollectionCreateButton slug="store-credits" />}
      searchPlaceholder="Search customers or account IDs"
      filters={filters}
      sortOptions={[{ value: "createdAt", label: "Created" }]}
      columns={columns}
      rows={rows}
      getRowId={(row) => row.id}
      isPending={isPending}
      errorMessage={result && !result.success ? result.message : null}
      onRetry={invalidate}
      emptyTitle="No store credit accounts"
      emptyDescription="Create an account to issue store credit to a customer."
      onRowClick={(row) =>
        void navigate({
          to: "/dashboard/$slug/$id",
          params: { slug: "store-credits", id: row.id },
        })
      }
      onRowPreload={(row) => preloadDetail(row.id)}
      pagination={result?.success ? result.data.pagination : undefined}
    />
  );
}
