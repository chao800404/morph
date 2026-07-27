import { CollectionCreateButton } from "@/routes/_backend/dashboard/-components/data-table-card";
import { EmptyFileIcon } from "@/components/ui/icons/empty-file-icon";
import { CardWrapper } from "@/routes/_backend/dashboard/-components/card-wrapper";

const Inventory = () => {


  return (
    <CardWrapper
      label="Inventory"
      description="Track and manage stock levels across items"
      headerButton={
        <CollectionCreateButton slug="inventory" />
      }
      classNames={{
        cardWrapper: "h-auto",
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
            <CollectionCreateButton slug="inventory" />
          </div>
        </div>
      </div>
    </CardWrapper>
  );
};

export default Inventory;
