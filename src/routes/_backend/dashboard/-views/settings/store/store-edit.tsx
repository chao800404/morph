import {
  RouteFormPage,
  useRouteModalClose,
  type RouteFormState,
} from "@/components/dialog/route-form-modal";
import { Spinner } from "@/components/ui/spinner";
import { updateStoreGeneral } from "@/server/currency/currencies.serverFn";
import { currencyQueries } from "@queries/currency.queries";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

const StoreEdit = () => {
  const close = useRouteModalClose();
  const queryClient = useQueryClient();
  const query = useQuery(currencyQueries.store());

  const submit = async (
    _state: RouteFormState,
    formData: FormData,
  ): Promise<RouteFormState> => {
    const result = await updateStoreGeneral({ data: formData });
    if (!result.success) {
      toast.error(result.message, { position: "top-center" });
      return result;
    }

    await queryClient.invalidateQueries({ queryKey: currencyQueries.all() });
    toast.success(result.message, { position: "top-center" });
    close();
    return result;
  };

  if (query.isPending) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center">
        <Spinner />
      </div>
    );
  }

  const store = query.data?.success ? query.data.data : null;
  if (!store) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center">
        <p className="text-sm text-muted-foreground">
          {query.data?.message ?? "Store settings could not be loaded"}
        </p>
      </div>
    );
  }

  const defaultCurrency =
    store.supportedCurrencies.find((currency) => currency.isDefault)?.code ??
    store.supportedCurrencies[0]?.code ??
    "";

  return (
    <RouteFormPage
      title="Edit Store"
      description={store.storeName}
      action={submit}
      submitLabel="Save"
      loadingLabel="Saving..."
      fields={[
        {
          type: "input",
          name: "name",
          label: "Name",
          value: store.storeName,
          required: true,
          autoFocus: true,
        },
        {
          type: "select",
          name: "defaultCurrencyCode",
          label: "Default currency",
          value: defaultCurrency,
          options: store.supportedCurrencies.map((currency) => ({
            label: `${currency.code.toUpperCase()} — ${currency.name}`,
            value: currency.code,
          })),
          required: true,
        },
      ]}
    />
  );
};

export default StoreEdit;
