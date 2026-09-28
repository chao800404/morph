import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CircleCheck, ShieldOff } from "lucide-react";
import { findCurrency, formatMoney } from "@/lib/currency/catalog";
import type { StoreCreditTransactionDTO } from "@/lib/store-credit/dto/store-credit.dto";
import { setStoreCreditAccountStatus } from "@/server/store-credit/store-credit.serverFn";
import { CardWrapper } from "@/routes/_backend/dashboard/-components/card-wrapper";
import {
  DataTableCard,
  type DataTableColumn,
} from "@/routes/_backend/dashboard/-components/data-table-card";
import {
  EditCard,
  type EditCardField,
} from "@/routes/_backend/dashboard/-components/edit-card/edit-card";
import {
  normalizeStoreCreditTransactionParams,
  storeCreditQueries,
} from "@queries/store-credit.queries";
import type { DashboardSearch } from "@/lib/validations/dashboard-search";
import { useInfoStore } from "@/routes/_backend/dashboard/-views/features/global-info/use-info-store";
import {
  useQuery,
  useQueryClient,
  useSuspenseQuery,
} from "@tanstack/react-query";
import { Link, useParams, useSearch } from "@tanstack/react-router";
import { useCallback, useMemo } from "react";
import { toast } from "sonner";
import { useShallow } from "zustand/react/shallow";

const formatBalance = (amount: number, currencyCode: string) => {
  const currency = findCurrency(currencyCode);
  return currency
    ? formatMoney(amount, currency)
    : `${amount} ${currencyCode.toUpperCase()}`;
};

export default function StoreCreditDetail() {
  const { id } = useParams({ strict: false }) as { id: string };
  const search = useSearch({ strict: false }) as DashboardSearch;
  const queryClient = useQueryClient();
  const { data: accountResult } = useSuspenseQuery(
    storeCreditQueries.detail(id),
  );
  const { setInfoData, setOpen } = useInfoStore(
    useShallow((state) => ({
      setInfoData: state.setInfoData,
      setOpen: state.setOpen,
    })),
  );
  const transactionParams = normalizeStoreCreditTransactionParams(id, search);
  const transactionQuery = useQuery(
    storeCreditQueries.transactions(transactionParams),
  );
  const account = accountResult.success ? accountResult.data.account : null;
  const transactions = transactionQuery.data?.success
    ? transactionQuery.data.data.transactions
    : [];

  const fields = useMemo<EditCardField[]>(() => {
    if (!account) return [];
    return [
      {
        key: "balance",
        label: "Current balance",
        value: formatBalance(account.balance, account.currencyCode),
      },
      {
        key: "customer",
        label: "Customer",
        value: account.customerName || account.customerEmail || "Unclaimed",
      },
      {
        key: "currency",
        label: "Currency",
        value: account.currencyCode.toUpperCase(),
      },
      {
        key: "status",
        label: "Status",
        value: account.status === "active" ? "Active" : "Disabled",
      },
      {
        key: "credits",
        label: "Total credits",
        value: formatBalance(account.totalCredits, account.currencyCode),
      },
      {
        key: "debits",
        label: "Total debits",
        value: formatBalance(account.totalDebits, account.currencyCode),
      },
      {
        key: "createdAt",
        label: "Created",
        value: new Date(account.createdAt).toLocaleString(),
      },
    ];
  }, [account]);

  const toggleStatus = useCallback(() => {
    if (!account) return;
    const status = account.status === "active" ? "disabled" : "active";
    const disabling = status === "disabled";
    setInfoData({
      title: disabling
        ? "Disable Store Credit Account"
        : "Enable Store Credit Account",
      description: disabling
        ? "Customers will no longer be able to apply this account to carts. A checkout already in progress will fail safely if this account is disabled before its balance is debited."
        : "This account will be available to its customer again.",
      fields: [],
      action: async () => {
        const response = await setStoreCreditAccountStatus({
          data: { id: account.id, status },
        });
        if (response.success)
          await queryClient.invalidateQueries({
            queryKey: storeCreditQueries.all(),
          });
        return { success: response.success, message: response.message };
      },
      confirmLabel: disabling ? "Disable account" : "Enable account",
      confirmVariant: disabling ? "destructive" : "default",
      onSuccess: () =>
        toast.success(disabling ? "Account disabled" : "Account enabled"),
    });
    setOpen(true);
  }, [account, queryClient, setInfoData, setOpen]);

  const columns = useMemo<DataTableColumn<StoreCreditTransactionDTO>[]>(
    () => [
      {
        key: "createdAt",
        header: "Date",
        className: "w-44 text-muted-foreground",
        cell: (row) => new Date(row.createdAt).toLocaleString(),
      },
      {
        key: "type",
        header: "Type",
        className: "w-28",
        cell: (row) => (
          <Badge variant={row.type === "credit" ? "success" : "neutral"}>
            {row.type === "credit" ? "Credit" : "Debit"}
          </Badge>
        ),
      },
      {
        key: "amount",
        header: "Amount",
        className: "w-36 text-right",
        cell: (row) =>
          formatBalance(row.amount, account?.currencyCode ?? "twd"),
      },
      {
        key: "reference",
        header: "Reference",
        className: "w-44",
        cell: (row) => row.reference ?? "—",
      },
      { key: "note", header: "Note", cell: (row) => row.note ?? "—" },
    ],
    [account?.currencyCode],
  );

  if (!account) {
    return (
      <CardWrapper label="Store Credit">
        <p className="border-t px-6 py-4 text-sm text-muted-foreground">
          {accountResult.message || "Store credit account not found"}
        </p>
      </CardWrapper>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <EditCard
        id="store-credit-account-general"
        title={
          account.customerName ||
          account.customerEmail ||
          "Unclaimed store credit"
        }
        fields={fields}
        headerActions={
          <div className="flex items-center gap-2">
            <Button asChild variant="form" size="xs">
              <Link
                to="/dashboard/$slug/$id/$page"
                params={{ slug: "store-credits", id, page: "adjust" }}
              >
                Adjust balance
              </Link>
            </Button>
            <Button
              type="button"
              variant="outline"
              size="xs"
              onClick={toggleStatus}
            >
              {account.status === "active" ? (
                <ShieldOff className="mr-1 size-3.5" />
              ) : (
                <CircleCheck className="mr-1 size-3.5" />
              )}
              {account.status === "active" ? "Disable" : "Enable"}
            </Button>
          </div>
        }
      />
      <DataTableCard
        label="Transactions"
        description="Credits and debits are recorded as an append-only ledger."
        columns={columns}
        rows={transactions}
        getRowId={(row) => row.id}
        isPending={transactionQuery.isPending}
        errorMessage={
          transactionQuery.data && !transactionQuery.data.success
            ? transactionQuery.data.message
            : null
        }
        onRetry={() =>
          void queryClient.invalidateQueries({
            queryKey: storeCreditQueries.all(),
          })
        }
        emptyTitle="No transactions yet"
        emptyDescription="Balance changes will appear here."
        pagination={
          transactionQuery.data?.success
            ? transactionQuery.data.data.pagination
            : undefined
        }
      />
    </div>
  );
}
