import { Button } from "@/components/ui/button";
import { EmptyFileIcon } from "@/components/ui/icons/empty-file-icon";
import { useCreateStore } from "@/routes/_backend/dashboard/-views/features/global-create/use-create-store";
import { CardWrapper } from "@/routes/_backend/dashboard/-components/card-wrapper";
import { Plus } from "lucide-react";
import { useShallow } from "zustand/react/shallow";

const Inventory = () => {
  const { setCreateData, setOpen: setCreateOpen } = useCreateStore(
    useShallow((state) => ({
      setCreateData: state.setCreateData,
      setOpen: state.setOpen,
    })),
  );

  const handleCreateInventory = () => {
    setCreateData({
      title: "Add Inventory Item",
      description: "Track and manage stock levels across items",
      fields: [
        {
          type: "input",
          name: "name",
          label: "Item Name",
          placeholder: "e.g. Size M Blue",
          required: true,
          autoFocus: true,
        },
        {
          type: "input",
          name: "quantity",
          label: "Quantity",
          placeholder: "100",
        },
      ],
      action: async ({ data }: { data: FormData }) => {
        const name = data.get("name");
        return { success: true, message: `Inventory item "${name || ""}" added successfully!` };
      },
    });
    setCreateOpen(true);
  };

  return (
    <CardWrapper
      label="Inventory"
      description="Track and manage stock levels across items"
      headerButton={
        <Button onClick={handleCreateInventory} variant="form" size="sm" className="gap-2">
          <Plus className="size-4" />
          Create
        </Button>
      }
      classNames={{
        cardWrapper: "min-h-[calc(100vh-6rem)]",
        contentWrapper: "flex flex-col items-center justify-center min-h-[400px]",
      }}
    >
      <div className="flex flex-col items-center justify-center text-center p-8">
        <div className="opacity-70 flex flex-col items-center gap-3">
          <EmptyFileIcon />
          <h3 className="text-lg font-medium text-foreground mt-2">No inventory records</h3>
          <p className="text-sm text-muted-foreground max-w-sm">
            Add inventory items to manage stock and quantities.
          </p>
          <div className="mt-4">
            <Button onClick={handleCreateInventory} variant="form" className="gap-2">
              <Plus className="size-4" />
              Add Inventory
            </Button>
          </div>
        </div>
      </div>
    </CardWrapper>
  );
};

export default Inventory;
