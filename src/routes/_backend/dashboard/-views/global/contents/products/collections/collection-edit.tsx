import {
  RouteFormPage,
  useRouteModalClose,
  type RouteFormState,
} from "@/components/dialog/route-form-modal";
import { handleField } from "@/components/form/handle-field";
import { Spinner } from "@/components/ui/spinner";
import { collectionQueries } from "@queries/product.queries";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "@tanstack/react-router";
import { toast } from "sonner";
import { updateCollectionAction } from "../product-actions";

/** Edit page for a product collection, at /dashboard/collections/<id>/edit. */
const CollectionEdit = () => {
  const { id } = useParams({ strict: false }) as { id: string };
  const queryClient = useQueryClient();
  const close = useRouteModalClose();
  const { data: result, isPending } = useQuery(collectionQueries.detail(id));

  const submit = async (
    _state: RouteFormState,
    formData: FormData,
  ): Promise<RouteFormState> => {
    formData.set("id", id);
    const response = await updateCollectionAction({ data: formData });

    if (!response.success) {
      toast.error(response.message, { position: "top-center" });
      return response;
    }

    await queryClient.invalidateQueries({ queryKey: collectionQueries.all() });
    toast.success(response.message, { position: "top-center" });
    close();
    return response;
  };

  if (isPending) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center">
        <Spinner />
      </div>
    );
  }

  const collection = result?.success ? result.data : null;
  if (!collection) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center">
        <p className="text-sm text-muted-foreground">
          {result?.message ?? "Collection not found"}
        </p>
      </div>
    );
  }

  return (
    <RouteFormPage
      title="Edit Collection"
      description={collection.title}
      action={submit}
      submitLabel="Save"
      loadingLabel="Saving..."
      fields={[
        {
          type: "input",
          name: "title",
          label: "Title",
          value: collection.title,
          required: true,
          autoFocus: true,
        },
        handleField({ derivedFrom: "title", value: collection.handle }),
        {
          type: "textarea",
          name: "description",
          label: "Description",
          value: collection.description ?? "",
          placeholder: "Short collection description...",
          rows: 3,
        },
      ]}
    />
  );
};

export default CollectionEdit;
