import {
  RouteFormPage,
  useRouteModalClose,
  type RouteFormState,
} from "@/components/dialog/route-form-modal";
import { handleField } from "@/components/form/handle-field";
import { collectionQueries } from "@queries/product.queries";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { createCollectionAction } from "../product-actions";

/** Create page for product collections, at /dashboard/collections/create. */
const CollectionCreate = () => {
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
        handleField({ derivedFrom: "title" }),
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

export default CollectionCreate;
