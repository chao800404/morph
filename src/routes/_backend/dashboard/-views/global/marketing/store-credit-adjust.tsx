import {
  RouteFormPage,
  useRouteModalClose,
  type RouteFormState,
} from "@/components/dialog/route-form-modal";
import { CardWrapper } from "@/routes/_backend/dashboard/-components/card-wrapper";
import { findCurrency, formatMoney } from "@/lib/currency/catalog";
import { adjustStoreCreditAccount } from "@/server/store-credit/store-credit.serverFn";
import { storeCreditQueries } from "@queries/store-credit.queries";
import { useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { useParams } from "@tanstack/react-router";
import { useRef } from "react";
import { toast } from "sonner";
import type { FormField } from "@/lib/validations/form";

export default function StoreCreditAdjust() {
  const { id } = useParams({ strict: false }) as { id: string };
  const close = useRouteModalClose();
  const queryClient = useQueryClient();
  const idempotencyKey = useRef<string | null>(null);
  const { data: result } = useSuspenseQuery(storeCreditQueries.detail(id));
  const account = result.success ? result.data.account : null;

  if (!account) {
    return (
      <CardWrapper label="Store Credit">
        <p className="border-t px-6 py-4 text-sm text-muted-foreground">
          {result.message || "Store credit account not found"}
        </p>
      </CardWrapper>
    );
  }

  const currency = findCurrency(account.currencyCode);
  const balance = currency
    ? formatMoney(account.balance, currency)
    : `${account.balance} ${account.currencyCode.toUpperCase()}`;
  const fields: FormField[] = [
    {
      type: "choice-cards",
      name: "type",
      label: "Adjustment",
      value: "credit",
      options: [
        {
          value: "credit",
          label: "Add credit",
          description: "Increase the customer's available balance.",
        },
        {
          value: "debit",
          label: "Deduct credit",
          description: "Reduce the balance for a manual correction.",
        },
      ],
    },
    {
      type: "input",
      name: "amount",
      label: `Amount (${account.currencyCode.toUpperCase()})`,
      inputType: "number",
      placeholder: "0.00",
      required: true,
      step: currency ? String(1 / 10 ** currency.decimalDigits) : "0.01",
    },
    {
      type: "textarea",
      name: "note",
      label: "Note",
      optional: true,
      placeholder: "Reason for this adjustment",
    },
  ];

  const submit = async (
    _state: RouteFormState,
    formData: FormData,
  ): Promise<RouteFormState> => {
    idempotencyKey.current ??= crypto.randomUUID();
    const response = await adjustStoreCreditAccount({
      data: {
        id,
        type: formData.get("type") === "debit" ? "debit" : "credit",
        amount: String(formData.get("amount") ?? "").trim(),
        note: String(formData.get("note") ?? "").trim() || null,
        idempotencyKey: idempotencyKey.current,
      },
    });
    if (!response.success) {
      toast.error(response.message, { position: "top-center" });
      return response;
    }
    idempotencyKey.current = null;
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: storeCreditQueries.all() }),
      queryClient.invalidateQueries({
        queryKey: storeCreditQueries.detail(id).queryKey,
      }),
    ]);
    toast.success(response.message, { position: "top-center" });
    close();
    return response;
  };

  return (
    <RouteFormPage
      title="Adjust Store Credit"
      description={`Current balance: ${balance}. The adjustment is recorded in the account ledger.`}
      action={submit}
      fields={fields}
      submitLabel="Save adjustment"
      loadingLabel="Saving adjustment..."
    />
  );
}
