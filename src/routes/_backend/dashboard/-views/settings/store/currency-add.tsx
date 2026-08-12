import { DialogFooterActions } from "@/components/dialog/dialog-footer-actions";
import {
  useCloseOnEscape,
  useRouteModalClose,
} from "@/components/dialog/route-modal-close";
import { RouteFullscreenSurface } from "@/components/dialog/route-fullscreen-surface";
import { Switch } from "@/components/ui/switch";
import type { CurrencyDTO } from "@/lib/currency/dto/currency.dto";
import type { DashboardSearch } from "@/lib/validations/dashboard-search";
import {
  DataTableCard,
  type DataTableColumn,
} from "@/routes/_backend/dashboard/-components/data-table-card";
import { addStoreCurrencies } from "@/server/currency/currencies.serverFn";
import { currencyQueries } from "@queries/currency.queries";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearch } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { CurrencyAddSkeleton } from "./currency-add-skeleton";

const PAGE_SIZE = 10;

const CurrencyAdd = () => {
  const close = useRouteModalClose();
  useCloseOnEscape(close);
  const routeSearch = useSearch({ strict: false }) as DashboardSearch;
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [taxInclusive, setTaxInclusive] = useState<Set<string>>(new Set());
  const [pending, setPending] = useState(false);
  const catalogQuery = useQuery(currencyQueries.available());
  const storeQuery = useQuery(currencyQueries.store());

  const currencies = catalogQuery.data?.success ? catalogQuery.data.data : [];
  const enabledCurrencies = storeQuery.data?.success
    ? storeQuery.data.data.supportedCurrencies
    : [];
  const enabledCodes = useMemo(
    () => new Set(enabledCurrencies.map((currency) => currency.code)),
    [enabledCurrencies],
  );
  const enabledTaxInclusive = useMemo(
    () =>
      new Set(
        enabledCurrencies
          .filter((currency) => currency.isTaxInclusive)
          .map((currency) => currency.code),
      ),
    [enabledCurrencies],
  );

  const visible = useMemo(() => {
    const value = (routeSearch.q ?? "").trim().toLocaleLowerCase();
    if (!value) return currencies;
    return currencies.filter(
      (currency) =>
        currency.code.includes(value) ||
        currency.name.toLocaleLowerCase().includes(value),
    );
  }, [currencies, routeSearch.q]);

  const totalPages = Math.max(1, Math.ceil(visible.length / PAGE_SIZE));
  const requestedPage = Math.max(1, Number(routeSearch.page) || 1);
  const page = Math.min(requestedPage, totalPages);
  const pageCurrencies = visible.slice(
    (page - 1) * PAGE_SIZE,
    page * PAGE_SIZE,
  );

  const toggle = (currency: CurrencyDTO, checked: boolean) => {
    if (enabledCodes.has(currency.code)) return;
    setSelected((current) => {
      const next = new Set(current);
      if (checked) next.add(currency.code);
      else next.delete(currency.code);
      return next;
    });
  };

  const toggleTaxInclusive = (currency: CurrencyDTO, checked: boolean) => {
    if (enabledCodes.has(currency.code)) return;
    setTaxInclusive((current) => {
      const next = new Set(current);
      if (checked) next.add(currency.code);
      else next.delete(currency.code);
      return next;
    });
    if (checked) toggle(currency, true);
  };

  const submit = async () => {
    if (selected.size === 0) return;
    setPending(true);
    try {
      const result = await addStoreCurrencies({
        data: {
          codes: [...selected],
          taxInclusiveCodes: [...selected].filter((code) =>
            taxInclusive.has(code),
          ),
        },
      });
      if (!result.success) {
        toast.error(result.message);
        return;
      }
      await queryClient.invalidateQueries({
        queryKey: currencyQueries.all(),
      });
      toast.success(result.message);
      close();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to add currencies",
      );
    } finally {
      setPending(false);
    }
  };

  const isLoading = catalogQuery.isPending || storeQuery.isPending;

  const columns = useMemo<DataTableColumn<CurrencyDTO>[]>(
    () => [
      {
        key: "code",
        header: "Code",
        className: "w-36 whitespace-nowrap",
        cell: (currency) => currency.code.toUpperCase(),
      },
      {
        key: "name",
        header: "Name",
        cell: (currency) => currency.name,
      },
      {
        key: "taxInclusive",
        header: "Tax inclusive pricing",
        className: "w-52 text-right",
        cell: (currency) => {
          const isEnabled = enabledCodes.has(currency.code);
          const checked = isEnabled
            ? enabledTaxInclusive.has(currency.code)
            : taxInclusive.has(currency.code);
          return (
            <div
              className="flex justify-end"
              onClick={(event) => event.stopPropagation()}
            >
              <Switch
                aria-label={`Tax inclusive pricing for ${currency.name}`}
                checked={checked}
                disabled={isEnabled}
                onCheckedChange={(value) => toggleTaxInclusive(currency, value)}
              />
            </div>
          );
        },
      },
    ],
    [enabledCodes, enabledTaxInclusive, taxInclusive],
  );

  if (isLoading) {
    return <CurrencyAddSkeleton onClose={close} />;
  }

  return (
    <RouteFullscreenSurface
      onClose={close}
      bodyClassName="flex min-h-0 flex-col overflow-hidden"
      footer={
        <DialogFooterActions
          isSheet={false}
          isLoading={pending}
          isDisabled={selected.size === 0}
          onCancel={close}
          onSubmit={() => void submit()}
          submitLabel="Save"
          loadingLabel="Saving..."
        />
      }
    >
      <DataTableCard
        label="Currencies"
        hideHeader
        layout="fill"
        className="h-full rounded-none ring-0"
        searchPlaceholder="Search currencies"
        columns={columns}
        rows={pageCurrencies}
        getRowId={(currency) => currency.code}
        emptyTitle="No currencies found"
        emptyDescription="Try another currency code or name."
        selection={{
          selectedIds: selected,
          onChange: setSelected,
          isRowSelectable: (currency) => !enabledCodes.has(currency.code),
          isRowSelected: (currency) => enabledCodes.has(currency.code),
        }}
        pagination={{
          page,
          limit: PAGE_SIZE,
          total: visible.length,
          totalPages,
        }}
      />
    </RouteFullscreenSurface>
  );
};

export default CurrencyAdd;
