import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  RouteFormPage,
  useRouteModalClose,
  type RouteFormState,
} from "@/components/dialog/route-form-modal";
import { CardWrapper } from "@/routes/_backend/dashboard/-components/card-wrapper";
import { createStoreCreditAccount } from "@/server/store-credit/store-credit.serverFn";
import { storeCreditQueries } from "@queries/store-credit.queries";
import type { FormField } from "@/lib/validations/form";
import { useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";

export default function StoreCreditCreate() {
  const close = useRouteModalClose();
  const queryClient = useQueryClient();
  const [claim, setClaim] = useState<{
    accountId: string;
    code: string;
  } | null>(null);
  const fields: FormField[] = [
    {
      type: "remote-select",
      name: "customerId",
      label: "Customer",
      remoteSource: "customers",
      searchPlaceholder: "Search by customer name or email",
      emptyMessage: "No matching customers",
      optional: true,
    },
    {
      type: "input",
      name: "currencyCode",
      label: "Currency code",
      value: "twd",
      placeholder: "twd",
      required: true,
      autoFocus: true,
      description: "Use a supported ISO currency code, such as TWD or USD.",
    },
    {
      type: "tip",
      name: "claimInfo",
      label: "Customer claim",
      description:
        "After creation, copy the one-time claim code and send it to the customer. They can claim the account from their storefront account page.",
    },
  ];

  const submit = async (
    _state: RouteFormState,
    formData: FormData,
  ): Promise<RouteFormState> => {
    const response = await createStoreCreditAccount({
      data: {
        customerId: String(formData.get("customerId") ?? "").trim() || null,
        currencyCode: String(formData.get("currencyCode") ?? "")
          .trim()
          .toLowerCase(),
      },
    });
    if (!response.success) {
      toast.error(response.message, { position: "top-center" });
      return response;
    }
    await queryClient.invalidateQueries({ queryKey: storeCreditQueries.all() });
    setClaim({
      accountId: response.data.account.id,
      code: response.data.claimCode,
    });
    toast.success("Store credit account created", { position: "top-center" });
    return response;
  };

  if (claim) {
    return (
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-4 p-6">
        <CardWrapper
          label="Account created"
          description="This claim code is shown only once. Copy it now and send it to the customer."
        >
          <div className="flex flex-col gap-3 px-6 py-4">
            <label
              htmlFor="store-credit-claim-code"
              className="text-sm font-medium text-foreground"
            >
              Claim code
            </label>
            <Input id="store-credit-claim-code" value={claim.code} readOnly />
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="form"
                size="sm"
                onClick={() =>
                  void navigator.clipboard
                    .writeText(claim.code)
                    .then(() => toast.success("Claim code copied"))
                    .catch(() => toast.error("Could not copy claim code"))
                }
              >
                Copy claim code
              </Button>
              <Button asChild type="button" variant="outline" size="sm">
                <Link
                  to="/dashboard/$slug/$id"
                  params={{ slug: "store-credits", id: claim.accountId }}
                >
                  View account
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
      title="Create Store Credit Account"
      description="Create a customer claim code. The account starts with a zero balance; add credit from its detail page."
      action={submit}
      fields={fields}
      submitLabel="Create account"
      loadingLabel="Creating account..."
    />
  );
}
