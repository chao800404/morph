import { Badge } from "@/components/ui/badge";
import { CommandBar } from "@/components/ui/command-bar";
import type { StoreCurrencyDTO } from "@/lib/currency/dto/currency.dto";
import type { DashboardSearch } from "@/lib/validations/dashboard-search";
import { CardWrapper } from "@/routes/_backend/dashboard/-components/card-wrapper";
import {
  DataTableCard,
  RowActionsMenu,
  type DataTableColumn,
} from "@/routes/_backend/dashboard/-components/data-table-card";
import { useInfoStore } from "@/routes/_backend/dashboard/-views/features/global-info/use-info-store";
import {
  removeStoreCurrencies,
  updateStoreCurrency,
} from "@/server/currency/currencies.serverFn";
import { currencyQueries } from "@queries/currency.queries";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { CheckCircle2, Pencil, Plus, Trash2, XCircle } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { useShallow } from "zustand/react/shallow";

const PAGE_SIZE = 10;

const columns: DataTableColumn<StoreCurrencyDTO>[] = [
  {
    key: "code",
    header: "Code",
    className: "w-32",
    cell: (currency) => currency.code.toUpperCase(),
  },
  {
    key: "name",
    header: "Name",
    cell: (currency) => currency.name,
  },
  {
    key: "tax-inclusive",
    header: "Tax inclusive pricing",
    className: "w-48",
    cell: (currency) => (
      <Badge variant={currency.isTaxInclusive ? "success" : "neutral"}>
        {currency.isTaxInclusive ? "True" : "False"}
      </Badge>
    ),
  },
];

const StoreGeneralSection = ({
  storeName,
  defaultCurrency,
}: {
  storeName: string;
  defaultCurrency?: StoreCurrencyDTO;
}) => {
  const navigate = useNavigate();

  return (
    <CardWrapper
      label="Store"
      description="Manage your store's details"
      headerButton={
        <RowActionsMenu
          label="Store actions"
          actions={[
            {
              label: "Edit",
              icon: <Pencil className="size-4" />,
              onSelect: () =>
                void navigate({
                  to: "/dashboard/settings/$slug/edit",
                  params: { slug: "store" },
                }),
            },
          ]}
        />
      }
      classNames={{ contentWrapper: "divide-y" }}
    >
      <div className="grid grid-cols-2 gap-4 px-6 py-4 text-sm text-muted-foreground">
        <span className="font-medium">Name</span>
        <span>{storeName}</span>
      </div>
      <div className="grid grid-cols-2 gap-4 px-6 py-4 text-sm text-muted-foreground">
        <span className="font-medium">Default currency</span>
        {defaultCurrency ? (
          <span className="flex items-center gap-2">
            <Badge variant="embossed">
              {defaultCurrency.code.toUpperCase()}
            </Badge>
            {defaultCurrency.name}
          </span>
        ) : (
          <span>—</span>
        )}
      </div>
    </CardWrapper>
  );
};

const Store = () => {
  const navigate = useNavigate();
  const search = useSearch({ strict: false }) as DashboardSearch;
  const queryClient = useQueryClient();
  const query = useQuery(currencyQueries.store());
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const { setInfoData, setInfoOpen } = useInfoStore(
    useShallow((state) => ({
      setInfoData: state.setInfoData,
      setInfoOpen: state.setOpen,
    })),
  );

  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: currencyQueries.all() });

  const updateTax = useMutation({
    mutationFn: ({
      code,
      isTaxInclusive,
    }: {
      code: string;
      isTaxInclusive: boolean;
    }) => updateStoreCurrency({ data: { code, isTaxInclusive } }),
    onSuccess: async (result) => {
      if (!result.success) {
        toast.error(result.message);
        return;
      }
      await refresh();
      toast.success(result.message);
    },
  });

  const result = query.data;
  const currencies = result?.success ? result.data.supportedCurrencies : [];
  const defaultCurrency = currencies.find((currency) => currency.isDefault);
  const normalizedQuery = search.q?.trim().toLocaleLowerCase() ?? "";
  const sortBy = Array.isArray(search.sortBy)
    ? search.sortBy[0]
    : search.sortBy;
  const sortOrder = Array.isArray(search.sortOrder)
    ? search.sortOrder[0]
    : search.sortOrder;
  const page = Math.max(1, Number(search.page) || 1);

  const filteredCurrencies = useMemo(() => {
    const filtered = normalizedQuery
      ? currencies.filter(
          (currency) =>
            currency.code.includes(normalizedQuery) ||
            currency.name.toLocaleLowerCase().includes(normalizedQuery),
        )
      : currencies;
    const key = sortBy === "name" ? "name" : "code";
    const direction = sortOrder === "desc" ? -1 : 1;
    return [...filtered].sort(
      (left, right) => left[key].localeCompare(right[key]) * direction,
    );
  }, [currencies, normalizedQuery, sortBy, sortOrder]);

  const totalPages = Math.max(
    1,
    Math.ceil(filteredCurrencies.length / PAGE_SIZE),
  );
  const safePage = Math.min(page, totalPages);
  const rows = filteredCurrencies.slice(
    (safePage - 1) * PAGE_SIZE,
    safePage * PAGE_SIZE,
  );
  const errorMessage =
    query.error instanceof Error
      ? query.error.message
      : result && !result.success
        ? result.message
        : null;

  const requestRemove = (codes: string[]) => {
    if (codes.length === 0) return;
    setInfoData({
      title: "Remove currencies",
      description: `Remove ${codes.length} selected currencies from this store?`,
      fields: [
        {
          type: "hidden",
          name: "codes",
          defaultValue: JSON.stringify(codes),
        },
      ],
      action: removeStoreCurrencies,
      confirmLabel: "Remove",
      confirmVariant: "destructive",
      onSuccess: () => {
        setSelectedIds(new Set());
        void refresh();
      },
    });
    setInfoOpen(true);
  };

  const requestBatchRemove = () => requestRemove([...selectedIds]);

  return (
    <div className="mx-auto flex h-auto w-full flex-col gap-3">
      <StoreGeneralSection
        storeName={result?.success ? result.data.storeName : "Morph store"}
        defaultCurrency={defaultCurrency}
      />

      <DataTableCard
        label="Currencies"
        columns={columns}
        rows={rows}
        getRowId={(currency) => currency.code}
        isPending={query.isPending}
        errorMessage={errorMessage}
        onRetry={() => void query.refetch()}
        emptyTitle="No currencies enabled"
        emptyDescription="Add a currency before assigning prices to products."
        searchPlaceholder="Search"
        sortOptions={[
          { value: "code", label: "Code" },
          { value: "name", label: "Name" },
        ]}
        defaultSortBy="code"
        headerActions={
          <RowActionsMenu
            label="Currency actions"
            actions={[
              {
                label: "Add",
                icon: <Plus className="size-4" />,
                onSelect: () =>
                  void navigate({
                    to: "/dashboard/settings/$slug/create",
                    params: { slug: "store" },
                  }),
              },
            ]}
          />
        }
        selection={{
          selectedIds,
          onChange: setSelectedIds,
          isRowSelectable: (currency) => !currency.isDefault,
        }}
        pagination={{
          page: safePage,
          limit: PAGE_SIZE,
          total: filteredCurrencies.length,
          totalPages,
        }}
        rowActions={(currency) => [
          {
            label: currency.isTaxInclusive
              ? "Disable tax inclusive pricing"
              : "Enable tax inclusive pricing",
            icon: currency.isTaxInclusive ? (
              <XCircle className="size-4" />
            ) : (
              <CheckCircle2 className="size-4" />
            ),
            onSelect: () =>
              updateTax.mutate({
                code: currency.code,
                isTaxInclusive: !currency.isTaxInclusive,
              }),
          },
          {
            label: "Remove",
            icon: <Trash2 className="size-4" />,
            destructive: true,
            disabled: currency.isDefault,
            onSelect: () => requestRemove([currency.code]),
          },
        ]}
      />

      <CommandBar
        open={selectedIds.size > 0}
        value={`${selectedIds.size} selected`}
        onClear={() => setSelectedIds(new Set())}
        actions={[
          {
            id: "remove",
            label: "Remove",
            shortcut: "R",
            destructive: true,
            onAction: requestBatchRemove,
          },
        ]}
      />
    </div>
  );
};

export default Store;
