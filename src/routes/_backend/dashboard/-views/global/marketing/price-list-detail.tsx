import { Button } from "@/components/ui/button";
import { formatMoney, findCurrency } from "@/lib/currency/catalog";
import type { PriceListPriceDTO } from "@/lib/pricing/dto/price-list.dto";
import type { DashboardSearch } from "@/lib/validations/dashboard-search";
import { findCollection } from "@/lib/config/navigation";
import { viewPreloader } from "@/lib/config/lazy-view";
import { CardWrapper } from "@/routes/_backend/dashboard/-components/card-wrapper";
import { DataTableCard, deleteActionIcon, useCollectionDetailPreload, type DataTableColumn } from "@/routes/_backend/dashboard/-components/data-table-card";
import { EditCard, type EditCardField } from "@/routes/_backend/dashboard/-components/edit-card/edit-card";
import { useInfoStore } from "@/routes/_backend/dashboard/-views/features/global-info/use-info-store";
import { getConfig } from "@/server/get-config";
import { normalizePriceListPriceParams, priceListQueries } from "@queries/price-list.queries";
import { useQuery, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { Link, useNavigate, useParams, useRouter, useSearch } from "@tanstack/react-router";
import { useCallback, useMemo } from "react";
import { toast } from "sonner";
import { useShallow } from "zustand/react/shallow";
import { removePriceListPrice } from "@/server/pricing/price-lists.serverFn";

export default function PriceListDetail() {
  const { id } = useParams({ strict: false }) as { id: string };
  const search = useSearch({ strict: false }) as DashboardSearch;
  const { data: result } = useSuspenseQuery(priceListQueries.detail(id));
  const priceList = result.success ? result.data : null;
  const params = normalizePriceListPriceParams(id, search);
  const priceQuery = useQuery(priceListQueries.prices(params));
  const pricesResult = priceQuery.data;
  const prices = pricesResult?.success ? pricesResult.data.prices : [];
  const queryClient = useQueryClient();
  const router = useRouter();
  const navigate = useNavigate();
  const preloadVariant = useCollectionDetailPreload("products");
  const editView = useMemo(() => findCollection(getConfig().client.collections.global, "price-lists")?.edit?.view, []);
  const openEdit = useCallback(() => void navigate({ to: "/dashboard/$slug/$id/edit", params: { slug: "price-lists", id } }), [id, navigate]);
  const preloadEdit = useCallback(() => {
    void viewPreloader(editView)?.();
    void router.preloadRoute({ to: "/dashboard/$slug/$id/edit", params: { slug: "price-lists", id } });
  }, [editView, id, router]);
  const { setInfoData, setOpen } = useInfoStore(useShallow((state) => ({ setInfoData: state.setInfoData, setOpen: state.setOpen })));
  const invalidate = useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: priceListQueries.all() }),
      queryClient.invalidateQueries({ queryKey: ["product-variants"] }),
    ]);
  }, [queryClient]);
  const columns = useMemo<DataTableColumn<PriceListPriceDTO>[]>(() => [
    { key: "product", header: "Product", className: "w-56 font-medium", cell: (row) => row.productTitle },
    { key: "variant", header: "Variant", cell: (row) => <span>{row.variantTitle}{row.sku ? <span className="ml-2 text-muted-foreground">{row.sku}</span> : null}</span> },
    { key: "price", header: "Price", className: "w-36 text-right", cell: (row) => { const currency = findCurrency(row.currencyCode); return currency ? formatMoney(row.amount, currency) : `${row.amount} ${row.currencyCode.toUpperCase()}`; } },
    { key: "quantity", header: "Quantity rule", className: "w-36", cell: (row) => {
      if (row.minQuantity === null && row.maxQuantity === null) return "Any quantity";
      if (row.minQuantity === null) return `Up to ${row.maxQuantity}`;
      return row.maxQuantity === null ? `${row.minQuantity}+` : `${row.minQuantity}–${row.maxQuantity}`;
    } },
  ], []);
  const removePrice = (row: PriceListPriceDTO) => {
    setInfoData({
      title: "Remove Price",
      description: `Remove the ${row.currencyCode.toUpperCase()} price for “${row.productTitle} — ${row.variantTitle}”${row.minQuantity === null && row.maxQuantity === null ? "" : ` at quantity ${row.minQuantity ?? "any"}–${row.maxQuantity ?? "up"}`} from this list?`,
      fields: [
        { type: "hidden", name: "priceListId", value: id },
        { type: "hidden", name: "priceId", value: row.id },
      ],
      action: async () => {
        const response = await removePriceListPrice({ data: { priceListId: id, priceId: row.id } });
        if (response.success) await invalidate();
        return { success: response.success, message: response.message };
      },
      confirmLabel: "Remove",
      confirmVariant: "destructive",
      onSuccess: () => { void invalidate(); toast.success("Price removed from list"); },
    });
    setOpen(true);
  };
  if (!priceList) return <CardWrapper label="Price List"><p className="border-t px-6 py-4 text-sm text-muted-foreground">{result.message ?? "Price list not found"}</p></CardWrapper>;
  const fields: EditCardField[] = [
    { key: "type", label: "Type", value: priceList.type === "sale" ? "Sale" : "Override" },
    { key: "status", label: "Status", value: priceList.status === "active" ? "Active" : "Draft" },
    { key: "prices", label: "Prices", value: String(priceList.priceCount) },
    { key: "groups", label: "Customer groups", value: priceList.customerGroupIds.length ? `${priceList.customerGroupIds.length} selected` : "All customers" },
    { key: "regions", label: "Regions", value: priceList.regionIds.length ? `${priceList.regionIds.length} selected` : "All regions" },
    { key: "startsAt", label: "Starts", value: priceList.startsAt ? new Date(priceList.startsAt).toLocaleString() : "Immediately" },
    { key: "endsAt", label: "Ends", value: priceList.endsAt ? new Date(priceList.endsAt).toLocaleString() : "No end date" },
    { key: "description", label: "Description", value: priceList.description || "—" },
  ];
  return (
    <div className="flex flex-col gap-4">
      <EditCard id="price-list-general" title={priceList.title} fields={fields} onEdit={openEdit} onEditPreload={preloadEdit} />
      <DataTableCard
        label="Prices"
        description={`${priceList.priceCount} variant prices in this list.`}
        headerActions={<Button variant="form" size="xs" asChild><Link to="/dashboard/$slug/$id/$page" params={{ slug: "price-lists", id, page: "add-price" }}>Add price</Link></Button>}
        searchPlaceholder="Search product variants"
        sortOptions={[{ value: "name", label: "Product" }, { value: "createdAt", label: "Created" }]}
        columns={columns}
        rows={prices}
        getRowId={(row) => row.id}
        isPending={priceQuery.isPending}
        errorMessage={pricesResult && !pricesResult.success ? pricesResult.message : null}
        onRetry={() => void queryClient.invalidateQueries({ queryKey: priceListQueries.all() })}
        emptyTitle="No prices yet"
        emptyDescription="Add variant prices to this list."
        onRowClick={(row) => void navigate({ to: "/dashboard/$slug/$id", params: { slug: "products", id: row.productId } })}
        onRowPreload={(row) => preloadVariant(row.productId)}
        rowActions={(row) => [{ label: "Remove", icon: deleteActionIcon, destructive: true, onSelect: () => removePrice(row) }]}
        pagination={pricesResult?.success ? pricesResult.data.pagination : undefined}
      />
    </div>
  );
}
