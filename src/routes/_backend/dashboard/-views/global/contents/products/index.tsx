import { Button } from "@/components/ui/button";
import { EmptyFileIcon } from "@/components/ui/icons/empty-file-icon";
import { useCreateStore } from "@/routes/_backend/dashboard/-views/features/global-create/use-create-store";
import { CardWrapper } from "@/routes/_backend/dashboard/-components/card-wrapper";
import { Plus } from "lucide-react";
import { useShallow } from "zustand/react/shallow";

const Products = () => {
  const { setCreateData, setOpen: setCreateOpen } = useCreateStore(
    useShallow((state) => ({
      setCreateData: state.setCreateData,
      setOpen: state.setOpen,
    })),
  );

  const handleCreateProduct = () => {
    setCreateData({
      title: "Create Product",
      description: "Add a new product to your catalog",
      fields: [
        {
          type: "input",
          name: "name",
          label: "Product Name",
          placeholder: "e.g. Summer T-Shirt",
          required: true,
          autoFocus: true,
        },
        {
          type: "input",
          name: "price",
          label: "Price ($)",
          placeholder: "0.00",
        },
        {
          type: "textarea",
          name: "description",
          label: "Description",
          placeholder: "Short product description...",
          rows: 3,
          className: "col-span-2",
        },
        {
          type: "upload",
          name: "assets",
          label: "Product Images",
          placeholder: "Select images",
          required: false,
          colSpan: 2,
          minSize: 1,
          maxFiles: 5,
          maxSize: 50 * 1024 * 1024,
        },
      ],
      action: async ({ data }: { data: FormData }) => {
        const name = data.get("name");
        return { success: true, message: `Product "${name || ""}" created successfully!` };
      },
    });
    setCreateOpen(true);
  };

  return (
    <CardWrapper
      label="Products"
      description="Manage your products and catalog"
      headerButton={
        <Button onClick={handleCreateProduct} variant="form" size="sm" className="gap-2">
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
          <h3 className="text-lg font-medium text-foreground mt-2">No products yet</h3>
          <p className="text-sm text-muted-foreground max-w-sm">
            Get started by creating your first product to display in your store.
          </p>
          <div className="mt-4">
            <Button onClick={handleCreateProduct} variant="form" className="gap-2">
              <Plus className="size-4" />
              Create First Product
            </Button>
          </div>
        </div>
      </div>
    </CardWrapper>
  );
};

export default Products;
