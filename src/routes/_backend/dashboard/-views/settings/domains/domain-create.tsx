import {
  RouteFormPage,
  useRouteModalClose,
} from "@/components/dialog/route-form-modal";
import { storefrontDomainQueries } from "@queries/storefront-domain.queries";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { createDomainAction } from "./domain-actions";
import { domainFormFields } from "./config/domain-form-fields";

export default function DomainCreate() {
  const client = useQueryClient();
  const close = useRouteModalClose();
  return (
    <RouteFormPage
      title="Connect domain"
      description="Connect a custom domain to your online store. Cloudflare will provision DNS routing and SSL."
      fields={domainFormFields()}
      action={async (state, form) => {
        const value = await createDomainAction(state, form);
        if (value.success) {
          await client.invalidateQueries({
            queryKey: storefrontDomainQueries.all(),
          });
          toast.success(value.message);
          close();
        }
        return value;
      }}
    />
  );
}
