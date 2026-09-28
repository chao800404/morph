import {
  RouteFormPage,
  useRouteModalClose,
  type RouteFormState,
} from "@/components/dialog/route-form-modal";
import { CardWrapper } from "@/routes/_backend/dashboard/-components/card-wrapper";
import {
  giftCardQueries,
} from "@queries/gift-card.queries";
import { updateGiftCardDetails } from "@/server/gift-card/gift-card.serverFn";
import { useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { useParams } from "@tanstack/react-router";
import { toast } from "sonner";
import type { FormField } from "@/lib/validations/form";

const localDateTimeValue = (value: string | null) => {
  if (!value) return "";
  const date = new Date(value);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
    .toISOString()
    .slice(0, 16);
};

export default function GiftCardEdit() {
  const { id } = useParams({ strict: false }) as { id: string };
  const close = useRouteModalClose();
  const queryClient = useQueryClient();
  const { data: result } = useSuspenseQuery(
    giftCardQueries.detail({ id, offset: 0, limit: 1 }),
  );
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

  const fields: FormField[] = [
    {
      type: "input",
      name: "expiresAt",
      label: "Expiration date",
      inputType: "datetime-local",
      defaultValue: localDateTimeValue(giftCard.expiresAt),
      optional: true,
      description: "Leave empty for a gift card that does not expire.",
    },
    {
      type: "textarea",
      name: "note",
      label: "Internal note",
      defaultValue: giftCard.note ?? "",
      optional: true,
      placeholder: "Internal note about this gift card",
    },
  ];

  const submit = async (
    _state: RouteFormState,
    formData: FormData,
  ): Promise<RouteFormState> => {
    const localExpiry = String(formData.get("expiresAt") ?? "").trim();
    const response = await updateGiftCardDetails({
      data: {
        id,
        expiresAt: localExpiry ? new Date(localExpiry).toISOString() : null,
        note: String(formData.get("note") ?? "").trim() || null,
      },
    });
    if (!response.success) {
      toast.error(response.message, { position: "top-center" });
      return response;
    }
    await queryClient.invalidateQueries({ queryKey: giftCardQueries.all() });
    toast.success("Gift card details updated", { position: "top-center" });
    close();
    return response;
  };

  return (
    <RouteFormPage
      title="Edit Gift Card Details"
      description="Update the expiration date or internal note. Balance changes are recorded separately in the transaction ledger."
      action={submit}
      fields={fields}
      submitLabel="Save changes"
      loadingLabel="Saving changes..."
    />
  );
}
