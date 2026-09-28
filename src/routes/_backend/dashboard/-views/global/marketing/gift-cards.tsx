import type { GiftCardDTO } from "@/lib/gift-card/dto/gift-card.dto";
import type { DashboardSearch } from "@/lib/validations/dashboard-search";
import { Badge } from "@/components/ui/badge";
import {
  CollectionCreateButton,
  DataTableCard,
  useCollectionDetailPreload,
  type DataTableColumn,
} from "@/routes/_backend/dashboard/-components/data-table-card";
import {
  normalizeGiftCardListParams,
  giftCardQueries,
} from "@queries/gift-card.queries";
import { formatMoney, findCurrency } from "@/lib/currency/catalog";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { useCallback, useMemo } from "react";

const statusLabel = (status: GiftCardDTO["status"]) =>
  status.charAt(0).toUpperCase() + status.slice(1);

export default function GiftCards() {
  const search = useSearch({ strict: false }) as DashboardSearch;
  const params = normalizeGiftCardListParams(search);
  const { data: result, isPending } = useQuery(giftCardQueries.list(params));
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const preloadDetail = useCollectionDetailPreload("gift-cards");
  const invalidate = useCallback(
    () =>
      void queryClient.invalidateQueries({ queryKey: giftCardQueries.all() }),
    [queryClient],
  );

  const columns = useMemo<DataTableColumn<GiftCardDTO>[]>(
    () => [
      {
        key: "id",
        header: "Gift card",
        className: "w-52 font-medium",
        cell: (row) => row.id,
      },
      {
        key: "initialValue",
        header: "Initial value",
        className: "w-36 text-right",
        cell: (row) => {
          const currency = findCurrency(row.currencyCode);
          return currency
            ? formatMoney(row.initialValue, currency)
            : `${row.initialValue} ${row.currencyCode.toUpperCase()}`;
        },
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
            {statusLabel(row.status)}
          </Badge>
        ),
      },
      {
        key: "expiresAt",
        header: "Expires",
        className: "w-36 text-muted-foreground",
        cell: (row) =>
          row.expiresAt ? new Date(row.expiresAt).toLocaleDateString() : "Never",
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

  const rows = result?.success ? result.data.giftCards : [];
  return (
    <DataTableCard
      label="Gift Cards"
      description="Issue prepaid balances, review redemptions, and manage expiration."
      headerActions={<CollectionCreateButton slug="gift-cards" />}
      searchPlaceholder="Search gift card IDs"
      columns={columns}
      rows={rows}
      getRowId={(row) => row.id}
      isPending={isPending}
      errorMessage={result && !result.success ? result.message : null}
      onRetry={invalidate}
      emptyTitle="No gift cards"
      emptyDescription="Issue a gift card to create a one-time redemption code."
      onRowClick={(row) =>
        void navigate({
          to: "/dashboard/$slug/$id",
          params: { slug: "gift-cards", id: row.id },
        })
      }
      onRowPreload={(row) => preloadDetail(row.id)}
      pagination={result?.success ? result.data.pagination : undefined}
    />
  );
}
