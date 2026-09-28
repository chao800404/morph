import {
  RouteFormPage,
  useRouteModalClose,
  type RouteFormState,
} from "@/components/dialog/route-form-modal";
import { inventoryQueries } from "@queries/inventory.queries";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { createInventoryItemAction } from "./inventory-actions";
import { inventoryItemFormFields } from "./inventory-form-fields";

const InventoryCreate = () => {
  const queryClient = useQueryClient();
  const close = useRouteModalClose();

  const submit = async (
    _state: RouteFormState,
    formData: FormData,
  ): Promise<RouteFormState> => {
    const result = await createInventoryItemAction({ data: formData });
    if (!result.success) {
      toast.error(result.message, { position: "top-center" });
      return result;
    }
    await queryClient.invalidateQueries({ queryKey: inventoryQueries.all() });
    toast.success("Inventory item created", { position: "top-center" });
    close();
    return result;
  };

  return (
    <RouteFormPage
      title="Create Inventory Item"
      description="Create a standalone item and manage its stock by location."
      action={submit}
      fields={inventoryItemFormFields()}
      fieldsClassName="sm:grid-cols-2"
    />
  );
};

export default InventoryCreate;
