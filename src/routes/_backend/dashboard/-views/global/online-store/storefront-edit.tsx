import {
  RouteFormPage,
  type RouteFormState,
  useRouteModalClose,
} from "@/components/dialog/route-form-modal";
import { RouteSurfaceMessage } from "@/components/dialog/route-surface-message";
import { RouteSurfacePending } from "@/components/dialog/route-surface-pending";
import type { FormField } from "@/lib/validations/form";
import { updateStorefront } from "@/server/storefront/storefronts.serverFn";
import { storefrontQueries } from "@queries/storefront.queries";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "@tanstack/react-router";
import { toast } from "sonner";

const value = (data: FormData, key: string) => {
  const entry = data.get(key);
  return typeof entry === "string" ? entry.trim() : "";
};

export default function StorefrontEdit() {
  const { id } = useParams({ strict: false }) as { id: string };
  const queryClient = useQueryClient();
  const close = useRouteModalClose();
  const query = useQuery(storefrontQueries.detail(id));
  const storefront = query.data?.success ? query.data.data : null;

  if (query.isPending) return <RouteSurfacePending />;
  if (!storefront)
    return (
      <RouteSurfaceMessage>
        {query.data?.message ?? "Storefront not found"}
      </RouteSurfaceMessage>
    );

  const fields: FormField[] = [
    { type: "hidden", name: "id", value: storefront.id },
    {
      type: "input",
      name: "name",
      label: "Website name",
      description: "The public name used by this online storefront.",
      value: storefront.name,
      required: true,
      autoFocus: true,
    },
    {
      type: "input",
      name: "seoTitle",
      label: "Default SEO title",
      description: "Used when a page does not provide its own SEO title.",
      value: storefront.preferences.seoTitle ?? "",
      optional: true,
    },
    {
      type: "textarea",
      name: "seoDescription",
      label: "Default SEO description",
      description: "Used when a page does not provide its own SEO description.",
      value: storefront.preferences.seoDescription ?? "",
      rows: 4,
      optional: true,
    },
  ];

  const submit = async (
    _state: RouteFormState,
    data: FormData,
  ): Promise<RouteFormState> => {
    const result = await updateStorefront({
      data: {
        id: value(data, "id"),
        name: value(data, "name"),
        seoTitle: value(data, "seoTitle") || undefined,
        seoDescription: value(data, "seoDescription") || undefined,
      },
    });
    if (!result.success) {
      toast.error(result.message, { position: "top-center" });
      return result;
    }
    await queryClient.invalidateQueries({ queryKey: storefrontQueries.all() });
    toast.success(result.message, { position: "top-center" });
    close();
    return result;
  };

  return (
    <RouteFormPage
      title="Edit website information"
      description="Manage the identity and default search metadata for this storefront."
      fields={fields}
      action={submit}
      submitLabel="Save"
      loadingLabel="Saving..."
    />
  );
}
