import {
  RouteFormPage,
  useRouteModalClose,
  type RouteFormState,
} from "@/components/dialog/route-form-modal";
import { collectionQueries } from "@queries/product.queries";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { createCollectionAction } from "../product-actions";

/** Create page for product collections, at /dashboard/collections/create. */
export const CollectionCreate = () => {
  const queryClient = useQueryClient();
  const close = useRouteModalClose();

  const submit = async (
    _state: RouteFormState,
    formData: FormData,
  ): Promise<RouteFormState> => {
    const result = await createCollectionAction({ data: formData });

    if (!result.success) {
      toast.error(result.message, { position: "top-center" });
      return result;
    }

    await queryClient.invalidateQueries({ queryKey: collectionQueries.all() });
    toast.success(result.message, { position: "top-center" });
    close();
    return result;
  };

  return (
    <RouteFormPage
      title="Create Collection"
      description="Group related products together"
      action={submit}
      fields={[
        {
          type: "input",
          name: "title",
          label: "Title",
          placeholder: "e.g. Summer Release",
          required: true,
          autoFocus: true,
        },
        {
          type: "input",
          name: "handle",
          label: "Handle",
          placeholder: "Leave blank to derive from the title",
        },
        {
          type: "textarea",
          name: "description",
          label: "Description",
          placeholder: "Short collection description...",
          rows: 3,
        },
      ]}
    />
  );
};
