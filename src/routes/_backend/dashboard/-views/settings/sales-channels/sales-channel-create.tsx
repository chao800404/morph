import {
  RouteFormPage,
  useRouteModalClose,
} from "@/components/dialog/route-form-modal";
import { salesChannelQueries } from "@queries/sales-channel.queries";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { createSalesChannelAction } from "../commerce-actions";
export default function SalesChannelCreate() {
  const client = useQueryClient();
  const close = useRouteModalClose();
  return (
    <RouteFormPage
      title="Create Sales Channel"
      description="Choose where a set of products can be sold."
      fields={[
        {
          type: "input",
          name: "name",
          label: "Name",
          required: true,
          autoFocus: true,
        },
        {
          type: "textarea",
          name: "description",
          label: "Description",
          rows: 3,
        },
        { type: "switch", name: "isDisabled", label: "Start disabled" },
      ]}
      action={async (state, data) => {
        const value = await createSalesChannelAction(state, data);
        if (value.success) {
          await client.invalidateQueries({
            queryKey: salesChannelQueries.all(),
          });
          toast.success(value.message);
          close();
        }
        return value;
      }}
    />
  );
}
