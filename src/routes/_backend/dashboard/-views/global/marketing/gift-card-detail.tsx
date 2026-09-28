import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CircleCheck, Pencil, ShieldOff } from "lucide-react";
import { findCurrency, formatMoney } from "@/lib/currency/catalog";
import type { StoreCreditTransactionDTO } from "@/lib/store-credit/dto/store-credit.dto";
import { setGiftCardStatus } from "@/server/gift-card/gift-card.serverFn";
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
  giftCardQueries,
  normalizeGiftCardTransactionParams,
} from "@queries/gift-card.queries";
import type { DashboardSearch } from "@/lib/validations/dashboard-search";
import { useInfoStore } from "@/routes/_backend/dashboard/-views/features/global-info/use-info-store";
import { useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { Link, useParams, useSearch } from "@tanstack/react-router";
import { useCallback, useMemo } from "react";
import { toast } from "sonner";
import { useShallow } from "zustand/react/shallow";

const formatAmount = (amount: number, currencyCode: string) => {
  const currency = findCurrency(currencyCode);
  return currency
    ? formatMoney(amount, currency)
    : `${amount} ${currencyCode.toUpperCase()}`;
};

export default function GiftCardDetail() {
  const { id } = useParams({ strict: false }) as { id: string };
  const search = useSearch({ strict: false }) as DashboardSearch;
  const queryClient = useQueryClient();
  const transactionParams = normalizeGiftCardTransactionParams(id, search);
  const { data: result, isPending } = useSuspenseQuery(
    giftCardQueries.detail(transactionParams),
  );
  const giftCard = result.success ? result.data.giftCard : null;
  const transactions = result.success ? result.data.transactions : [];
  const { setInfoData, setOpen } = useInfoStore(
    useShallow((state) => ({
      setInfoData: state.setInfoData,
      setOpen: state.setOpen,
    })),
  );

  const fields = useMemo<EditCardField[]>(() => {
    if (!giftCard) return [];
    return [
      {
        key: "initialValue",
        label: "Initial value",
        value: formatAmount(giftCard.initialValue, giftCard.currencyCode),
      },
      {
        key: "balance",
        label: "Current balance",
        value: formatAmount(giftCard.balance, giftCard.currencyCode),
      },
      {
        key: "currency",
        label: "Currency",
        value: giftCard.currencyCode.toUpperCase(),
      },
      {
        key: "status",
        label: "Status",
        value: giftCard.status,
      },
      {
        key: "expiresAt",
        label: "Expires",
        value: giftCard.expiresAt
          ? new Date(giftCard.expiresAt).toLocaleString()
          : "Never",
      },
      {
        key: "note",
        label: "Note",
        value: giftCard.note ?? "—",
      },
      {
        key: "credits",
        label: "Total credits",
        value: formatAmount(giftCard.totalCredits, giftCard.currencyCode),
      },
      {
        key: "debits",
        label: "Total debits",
        value: formatAmount(giftCard.totalDebits, giftCard.currencyCode),
      },
      {
        key: "createdAt",
        label: "Created",
        value: new Date(giftCard.createdAt).toLocaleString(),
      },
    ];
  }, [giftCard]);

  const toggleStatus = useCallback(() => {
    if (!giftCard) return;
    const status = giftCard.status === "disabled" ? "active" : "disabled";
    const disabling = status === "disabled";
    setInfoData({
      title: disabling ? "Disable Gift Card" : "Enable Gift Card",
      description: disabling
        ? "New cart applications and checkouts will be rejected. The existing balance and ledger remain available for audit."
        : "This gift card can be applied again if it has not expired and still has a balance.",
      fields: [],
      action: async () => {
        const response = await setGiftCardStatus({
          data: { id: giftCard.id, status },
        });
        if (response.success)
          await queryClient.invalidateQueries({
            queryKey: giftCardQueries.all(),
          });
        return { success: response.success, message: response.message };
      },
      confirmLabel: disabling ? "Disable gift card" : "Enable gift card",
      confirmVariant: disabling ? "destructive" : "default",
      onSuccess: () =>
        toast.success(disabling ? "Gift card disabled" : "Gift card enabled"),
    });
    setOpen(true);
  }, [giftCard, queryClient, setInfoData, setOpen]);

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
          formatAmount(row.amount, giftCard?.currencyCode ?? "twd"),
      },
      {
        key: "reference",
        header: "Reference",
        className: "w-44",
        cell: (row) => row.reference ?? "—",
      },
      { key: "note", header: "Note", cell: (row) => row.note ?? "—" },
    ],
    [giftCard?.currencyCode],
  );

  if (!giftCard) {
    return (
      <CardWrapper label="Gift Card">
        <p className="border-t px-6 py-4 text-sm text-muted-foreground">
          {result.message || "Gift card not found"}
        </p>
      </CardWrapper>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <EditCard
        id="gift-card-general"
        title={`Gift card ${giftCard.id.slice(0, 8)}`}
        fields={fields}
        headerActions={
          <div className="flex items-center gap-2">
            <Button asChild variant="outline" size="xs">
              <Link
                to="/dashboard/$slug/$id/edit"
                params={{ slug: "gift-cards", id }}
              >
                <Pencil className="mr-1 size-3.5" />
                Edit details
              </Link>
            </Button>
            <Button asChild variant="form" size="xs">
              <Link
                to="/dashboard/$slug/$id/$page"
                params={{ slug: "gift-cards", id, page: "adjust" }}
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
              {giftCard.status === "disabled" ? (
                <CircleCheck className="mr-1 size-3.5" />
              ) : (
                <ShieldOff className="mr-1 size-3.5" />
              )}
              {giftCard.status === "disabled" ? "Enable" : "Disable"}
            </Button>
          </div>
        }
      />
      <DataTableCard
        label="Transactions"
        description="Issuance, redemption, and balance adjustments are recorded in the shared append-only credit ledger."
        columns={columns}
        rows={transactions}
        getRowId={(row) => row.id}
        isPending={isPending}
        errorMessage={result && !result.success ? result.message : null}
        onRetry={() =>
          void queryClient.invalidateQueries({
            queryKey: giftCardQueries.all(),
          })
        }
        emptyTitle="No transactions yet"
        emptyDescription="Gift card balance changes will appear here."
        pagination={result.success ? result.data.pagination : undefined}
      />
    </div>
  );
}
