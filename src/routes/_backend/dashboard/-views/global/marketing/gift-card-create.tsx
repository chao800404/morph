import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  RouteFormPage,
  useRouteModalClose,
  type RouteFormState,
} from "@/components/dialog/route-form-modal";
import { CardWrapper } from "@/routes/_backend/dashboard/-components/card-wrapper";
import { createGiftCard } from "@/server/gift-card/gift-card.serverFn";
import { giftCardQueries } from "@queries/gift-card.queries";
import type { FormField } from "@/lib/validations/form";
import { useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";

export default function GiftCardCreate() {
  const close = useRouteModalClose();
  const queryClient = useQueryClient();
  const [created, setCreated] = useState<{
    id: string;
    code: string;
  } | null>(null);
  const fields: FormField[] = [
    {
      type: "input",
      name: "amount",
      label: "Initial value",
      inputType: "number",
      placeholder: "0.00",
      required: true,
      autoFocus: true,
      step: "0.01",
    },
    {
      type: "input",
      name: "currencyCode",
      label: "Currency code",
      value: "twd",
      placeholder: "twd",
      required: true,
      description: "Use a supported ISO currency code, such as TWD or USD.",
    },
    {
      type: "input",
      name: "expiresAt",
      label: "Expiration date",
      inputType: "datetime-local",
      optional: true,
      description: "Leave empty for a gift card that does not expire.",
    },
    {
      type: "textarea",
      name: "note",
      label: "Note",
      optional: true,
      placeholder: "Reason for issuing this gift card",
    },
  ];

  const submit = async (
    _state: RouteFormState,
    formData: FormData,
  ): Promise<RouteFormState> => {
    const localExpiry = String(formData.get("expiresAt") ?? "").trim();
    const response = await createGiftCard({
      data: {
        amount: String(formData.get("amount") ?? "").trim(),
        currencyCode: String(formData.get("currencyCode") ?? "")
          .trim()
          .toLowerCase(),
        expiresAt: localExpiry ? new Date(localExpiry).toISOString() : null,
        note: String(formData.get("note") ?? "").trim() || null,
      },
    });
    if (!response.success) {
      toast.error(response.message, { position: "top-center" });
      return response;
    }
    await queryClient.invalidateQueries({ queryKey: giftCardQueries.all() });
    setCreated({
      id: response.data.giftCard.id,
      code: response.data.code,
    });
    toast.success("Gift card created", { position: "top-center" });
    return response;
  };

  if (created) {
    return (
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-4 p-6">
        <CardWrapper
          label="Gift card created"
          description="This redemption code is shown only once. Copy it now and send it to the recipient."
        >
          <div className="flex flex-col gap-3 px-6 py-4">
            <label
              htmlFor="gift-card-code"
              className="text-sm font-medium text-foreground"
            >
              Redemption code
            </label>
            <Input id="gift-card-code" value={created.code} readOnly />
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="form"
                size="sm"
                onClick={() =>
                  void navigator.clipboard
                    .writeText(created.code)
                    .then(() => toast.success("Gift card code copied"))
                    .catch(() => toast.error("Could not copy gift card code"))
                }
              >
                Copy code
              </Button>
              <Button asChild type="button" variant="outline" size="sm">
                <Link
                  to="/dashboard/$slug/$id"
                  params={{ slug: "gift-cards", id: created.id }}
                >
                  View gift card
                </Link>
              </Button>
              <Button type="button" variant="ghost" size="sm" onClick={close}>
                Close
              </Button>
            </div>
          </div>
        </CardWrapper>
      </div>
    );
  }

  return (
    <RouteFormPage
      title="Create Gift Card"
      description="Issue a one-time redemption code. The initial balance is written to the gift card ledger."
      action={submit}
      fields={fields}
      submitLabel="Create gift card"
      loadingLabel="Creating gift card..."
    />
  );
}
