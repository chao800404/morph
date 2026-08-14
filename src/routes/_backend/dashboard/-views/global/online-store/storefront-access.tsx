import {
  RouteFormPage,
  type RouteFormState,
  useRouteModalClose,
} from "@/components/dialog/route-form-modal";
import { RouteSurfaceMessage } from "@/components/dialog/route-surface-message";
import { RouteSurfacePending } from "@/components/dialog/route-surface-pending";
import type { FormField } from "@/lib/validations/form";
import { updateStorefrontAccess } from "@/server/storefront/storefronts.serverFn";
import { storefrontQueries } from "@queries/storefront.queries";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "@tanstack/react-router";
import { toast } from "sonner";

const value = (data: FormData, key: string) => {
  const entry = data.get(key);
  return typeof entry === "string" ? entry : "";
};

export default function StorefrontAccess() {
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

  const accessOptions = [
    {
      label: "Private",
      value: "private",
    },
    ...(storefront.domain || storefront.preferences.accessMode === "public"
      ? [{ label: "Public", value: "public" }]
      : []),
  ];
  const fields: FormField[] = [
    { type: "hidden", name: "id", value: storefront.id },
    {
      type: "select",
      name: "accessMode",
      label: "Storefront access",
      description:
        storefront.preferences.accessMode === "public"
          ? "Anyone can visit the published storefront."
          : "Only authorized dashboard users can preview the storefront.",
      value: storefront.preferences.accessMode,
      options: accessOptions,
      required: true,
    },
    {
      type: "tip",
      name: "domainRequirement",
      label: storefront.domain ? "Primary domain" : "Public access unavailable",
      description: storefront.domain
        ? `Public access will use ${storefront.domain}.`
        : "Connect and activate a primary domain in Settings before making this storefront public.",
    },
  ];

  const submit = async (
    _state: RouteFormState,
    data: FormData,
  ): Promise<RouteFormState> => {
    const accessMode = value(data, "accessMode");
    if (accessMode !== "private" && accessMode !== "public")
      return {
        message: "Choose a valid storefront access mode",
        errors: { accessMode: ["Choose a valid storefront access mode"] },
      };
    const result = await updateStorefrontAccess({
      data: { id: value(data, "id"), accessMode },
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
      title="Manage storefront access"
      description="Control whether the published storefront is private or available to visitors."
      fields={fields}
      action={submit}
      submitLabel="Save"
      loadingLabel="Saving..."
    />
  );
}
