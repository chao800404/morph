import {
  RouteFormPage,
  useRouteModalClose,
  type RouteFormState,
} from "@/components/dialog/route-form-modal";
import { storefrontPageQueries } from "@queries/storefront-page.queries";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { createPageAction } from "./page-actions";
import { pageFormFields } from "./config/page-form-fields";

export default function StorefrontPageCreate() {
  const client = useQueryClient();
  const close = useRouteModalClose();
  const submit = async (
    _state: RouteFormState,
    data: FormData,
  ): Promise<RouteFormState> => {
    const result = await createPageAction({ data });
    if (!result.success) {
      toast.error(result.message, { position: "top-center" });
      return result;
    }
    await client.invalidateQueries({ queryKey: storefrontPageQueries.all() });
    toast.success(result.message, { position: "top-center" });
    close();
    return result;
  };
  return (
    <RouteFormPage
      title="Create page"
      description="Start with a versioned empty document. Sections can be added by the visual editor next."
      action={submit}
      fields={pageFormFields()}
    />
  );
}
