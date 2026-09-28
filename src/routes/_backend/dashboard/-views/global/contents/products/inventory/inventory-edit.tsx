import { RouteSurfaceMessage } from "@/components/dialog/route-surface-message";
import { RouteSurfacePending } from "@/components/dialog/route-surface-pending";
import {
  RouteFormPage,
  useRouteModalClose,
  type RouteFormState,
} from "@/components/dialog/route-form-modal";
import { inventoryQueries } from "@queries/inventory.queries";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "@tanstack/react-router";
import { toast } from "sonner";
import { updateInventoryItemAction } from "./inventory-actions";
import { inventoryItemFormFields } from "./inventory-form-fields";

const InventoryEdit = () => {
  const { id } = useParams({ strict: false }) as { id: string };
  const queryClient = useQueryClient();
  const close = useRouteModalClose();
  const { data: result, isPending } = useQuery(inventoryQueries.detail(id));
  const item = result?.success ? result.data : null;

  const submit = async (
    _state: RouteFormState,
    formData: FormData,
  ): Promise<RouteFormState> => {
    formData.set("id", id);
    const response = await updateInventoryItemAction({ data: formData });
    if (!response.success) {
      toast.error(response.message, { position: "top-center" });
      return response;
    }
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: inventoryQueries.all() }),
      queryClient.invalidateQueries({
        queryKey: inventoryQueries.detail(id).queryKey,
      }),
    ]);
    toast.success("Inventory item updated", { position: "top-center" });
    close();
    return response;
  };

  if (isPending) return <RouteSurfacePending />;
  if (!item) {
    return (
      <RouteSurfaceMessage>
        {result?.message ?? "Inventory item not found"}
      </RouteSurfaceMessage>
    );
  }

  return (
    <RouteFormPage
      title="Edit Inventory Item"
      description={item.title ?? "Update item details"}
      action={submit}
      submitLabel="Save"
      loadingLabel="Saving..."
      fields={inventoryItemFormFields(item)}
      fieldsClassName="sm:grid-cols-2"
    />
  );
};

export default InventoryEdit;
