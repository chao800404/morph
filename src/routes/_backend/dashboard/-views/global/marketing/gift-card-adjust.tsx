import {
  RouteFormPage,
  useRouteModalClose,
  type RouteFormState,
} from "@/components/dialog/route-form-modal";
import { CardWrapper } from "@/routes/_backend/dashboard/-components/card-wrapper";
import { findCurrency, formatMoney } from "@/lib/currency/catalog";
import {
  giftCardQueries,
  normalizeGiftCardTransactionParams,
} from "@queries/gift-card.queries";
import { adjustGiftCard } from "@/server/gift-card/gift-card.serverFn";
import { useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { useParams, useSearch } from "@tanstack/react-router";
import { useRef } from "react";
import { toast } from "sonner";
import type { FormField } from "@/lib/validations/form";
import type { DashboardSearch } from "@/lib/validations/dashboard-search";

export default function GiftCardAdjust() {
  const { id } = useParams({ strict: false }) as { id: string };
  const search = useSearch({ strict: false }) as DashboardSearch;
  const close = useRouteModalClose();
  const queryClient = useQueryClient();
  const idempotencyKey = useRef<string | null>(null);
  const params = normalizeGiftCardTransactionParams(id, search);
  const { data: result } = useSuspenseQuery(giftCardQueries.detail(params));
  const giftCard = result.success ? result.data.giftCard : null;

  if (!giftCard) {
    return (
      <CardWrapper label="Gift Card">
        <p className="border-t px-6 py-4 text-sm text-muted-foreground">
          {result.message || "Gift card not found"}
        </p>
      </CardWrapper>
    );
  }

  const currency = findCurrency(giftCard.currencyCode);
  const balance = currency
    ? formatMoney(giftCard.balance, currency)
    : `${giftCard.balance} ${giftCard.currencyCode.toUpperCase()}`;
  const fields: FormField[] = [
    {
      type: "choice-cards",
      name: "type",
      label: "Adjustment",
      value: "credit",
      options: [
        {
          value: "credit",
          label: "Add balance",
          description: "Increase the remaining gift card balance.",
        },
        {
          value: "debit",
          label: "Deduct balance",
          description: "Reduce the balance for a manual correction.",
        },
      ],
    },
    {
      type: "input",
      name: "amount",
      label: `Amount (${giftCard.currencyCode.toUpperCase()})`,
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
    const response = await adjustGiftCard({
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
    await queryClient.invalidateQueries({ queryKey: giftCardQueries.all() });
    toast.success(response.message, { position: "top-center" });
    close();
    return response;
  };

  return (
    <RouteFormPage
      title="Adjust Gift Card Balance"
      description={`Current balance: ${balance}. Every adjustment is recorded in the gift card ledger.`}
      action={submit}
      fields={fields}
      submitLabel="Save adjustment"
      loadingLabel="Saving adjustment..."
    />
  );
}
