import { DialogFooterActions } from "@/components/dialog/dialog-footer-actions";
import {
  useCloseOnEscape,
  useRouteModalClose,
} from "@/components/dialog/route-form-modal";
import { RouteFullscreenSurface } from "@/components/dialog/route-fullscreen-surface";
import { Checkbox } from "@/components/ui/checkbox";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TABLE_HEADER_HEIGHT_PX,
  TABLE_ROW_HEIGHT_PX,
} from "@/components/ui/table";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { CurrencyDTO } from "@/lib/currency/dto/currency.dto";
import type { DashboardSearch } from "@/lib/validations/dashboard-search";
import {
  calculatePageForPreservedOffset,
  DataTablePagination,
  DataTableToolbar,
  useResponsiveTablePageSize,
} from "@/routes/_backend/dashboard/-components/data-table-card";
import { addStoreCurrencies } from "@/server/currency/currencies.serverFn";
import { currencyQueries } from "@queries/currency.queries";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { CurrencyAddSkeleton } from "./currency-add-skeleton";

const FALLBACK_PAGE_SIZE = 10;

const CurrencyAdd = () => {
  const close = useRouteModalClose();
  useCloseOnEscape(close);
  const navigate = useNavigate();
  const routeSearch = useSearch({ strict: false }) as DashboardSearch;
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [taxInclusive, setTaxInclusive] = useState<Set<string>>(new Set());
  const [pending, setPending] = useState(false);
  const previousPageSize = useRef(FALLBACK_PAGE_SIZE);
  const { containerRef: tableViewportRef, pageSize } =
    useResponsiveTablePageSize({
      rowHeight: TABLE_ROW_HEIGHT_PX,
      headerHeight: TABLE_HEADER_HEIGHT_PX,
      fallback: FALLBACK_PAGE_SIZE,
    });
  const catalogQuery = useQuery(currencyQueries.available());
  const storeQuery = useQuery(currencyQueries.store());

  const currencies = catalogQuery.data?.success
    ? catalogQuery.data.data
    : [];
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
    const value = search.trim().toLocaleLowerCase();
    if (!value) return currencies;
    return currencies.filter(
      (currency) =>
        currency.code.includes(value) ||
        currency.name.toLocaleLowerCase().includes(value),
    );
  }, [currencies, search]);

  const totalPages = Math.max(1, Math.ceil(visible.length / pageSize));
  const requestedPage = Math.max(1, Number(routeSearch.page) || 1);
  const page = Math.min(requestedPage, totalPages);
  const pageCurrencies = visible.slice(
    (page - 1) * pageSize,
    page * pageSize,
  );
  const selectablePage = pageCurrencies.filter(
    (currency) => !enabledCodes.has(currency.code),
  );
  const allPageSelected =
    selectablePage.length > 0 &&
    selectablePage.every((currency) => selected.includes(currency.code));
  const somePageSelected = selectablePage.some((currency) =>
    selected.includes(currency.code),
  );

  useEffect(() => {
    const previous = previousPageSize.current;
    if (previous === pageSize) return;

    const nextPage = calculatePageForPreservedOffset(
      requestedPage,
      previous,
      pageSize,
    );
    previousPageSize.current = pageSize;

    if (nextPage === requestedPage) return;
    void navigate({
      to: ".",
      search: (current: DashboardSearch) => ({
        ...current,
        page: nextPage,
      }),
      replace: true,
    });
  }, [navigate, pageSize, requestedPage]);

  const toggle = (currency: CurrencyDTO, checked: boolean) => {
    if (enabledCodes.has(currency.code)) return;
    setSelected((current) =>
      checked
        ? [...new Set([...current, currency.code])]
        : current.filter((code) => code !== currency.code),
    );
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
    if (selected.length === 0) return;
    setPending(true);
    try {
      const result = await addStoreCurrencies({
        data: {
          codes: selected,
          taxInclusiveCodes: selected.filter((code) =>
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
          isDisabled={selected.length === 0}
          onCancel={close}
          onSubmit={() => void submit()}
          submitLabel="Save"
          loadingLabel="Saving..."
        />
      }
    >
      <div className="flex min-h-0 flex-1 flex-col">
        <DataTableToolbar
          className="border-t-0"
          trailing={
            <InputGroup
              variant="cardHeader"
              size="xs"
              className="w-60 max-md:w-full"
            >
              <InputGroupAddon>
                <Search className="size-4" />
              </InputGroupAddon>
              <InputGroupInput
                autoFocus
                aria-label="Search currencies"
                value={search}
                onChange={(event) => {
                  setSearch(event.target.value);
                  void navigate({
                    to: ".",
                    search: (previous: DashboardSearch) => ({
                      ...previous,
                      page: 1,
                    }),
                    replace: true,
                  });
                }}
                placeholder="Search"
              />
            </InputGroup>
          }
        />

        <div
          ref={tableViewportRef}
          className="min-h-0 flex-1 overflow-auto"
        >
          <Table className="min-w-[640px]">
            <TableHeader>
              <TableRow>
                <TableHead className="w-14 pl-6">
                  <Checkbox
                    aria-label="Select all available currencies"
                    checked={allPageSelected}
                    isIndeterminate={
                      somePageSelected && !allPageSelected
                    }
                    onCheckedChange={(checked) => {
                      const codes = new Set(selected);
                      selectablePage.forEach((currency) => {
                        if (checked === true) codes.add(currency.code);
                        else codes.delete(currency.code);
                      });
                      setSelected([...codes]);
                    }}
                  />
                </TableHead>
                <TableHead className="w-36">Code</TableHead>
                <TableHead>Name</TableHead>
                <TableHead className="w-52 pr-6 text-right">
                  Tax inclusive pricing
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pageCurrencies.map((currency) => {
                const isEnabled = enabledCodes.has(currency.code);
                const checked =
                  isEnabled || selected.includes(currency.code);
                const isTaxInclusive = isEnabled
                  ? enabledTaxInclusive.has(currency.code)
                  : taxInclusive.has(currency.code);
                const checkbox = (
                  <Checkbox
                    aria-label={`Select ${currency.name}`}
                    checked={checked}
                    disabled={isEnabled}
                    onClick={(event) => event.stopPropagation()}
                    onCheckedChange={(value) =>
                      toggle(currency, value === true)
                    }
                  />
                );

                return (
                  <TableRow
                    key={currency.code}
                    data-state={checked && !isEnabled ? "selected" : undefined}
                    className={isEnabled ? undefined : "cursor-pointer"}
                    onClick={() => toggle(currency, !checked)}
                  >
                    <TableCell className="pl-6">
                      {isEnabled ? (
                        <Tooltip>
                          <TooltipTrigger asChild>{checkbox}</TooltipTrigger>
                          <TooltipContent side="right">
                            Currency already added
                          </TooltipContent>
                        </Tooltip>
                      ) : (
                        checkbox
                      )}
                    </TableCell>
                    <TableCell>{currency.code.toUpperCase()}</TableCell>
                    <TableCell>{currency.name}</TableCell>
                    <TableCell className="pr-6">
                      <div className="flex justify-end">
                        <Switch
                          aria-label={`Tax inclusive pricing for ${currency.name}`}
                          checked={isTaxInclusive}
                          disabled={isEnabled}
                          onClick={(event) => event.stopPropagation()}
                          onCheckedChange={(value) =>
                            toggleTaxInclusive(currency, value)
                          }
                        />
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>

          {visible.length === 0 ? (
            <p className="p-8 text-center text-sm text-muted-foreground">
              No currencies found.
            </p>
          ) : null}
        </div>

        {visible.length > 0 ? (
          <DataTablePagination
            pagination={{
              page,
              limit: pageSize,
              total: visible.length,
              totalPages,
            }}
          />
        ) : null}
      </div>
    </RouteFullscreenSurface>
  );
};

export default CurrencyAdd;
