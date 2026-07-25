import { Button } from "@/components/ui/button";
import { EmptyFileIcon } from "@/components/ui/icons/empty-file-icon";
import { useCreateStore } from "@/routes/_backend/dashboard/-views/features/global-create/use-create-store";
import { CardWrapper } from "@/routes/_backend/dashboard/-components/card-wrapper";
import { Plus } from "lucide-react";
import { useShallow } from "zustand/react/shallow";

const Collections = () => {
  const { setCreateData, setOpen: setCreateOpen } = useCreateStore(
    useShallow((state) => ({
      setCreateData: state.setCreateData,
      setOpen: state.setOpen,
    })),
  );

  const handleCreateCollection = () => {
    setCreateData({
      title: "Create Collection",
      description: "Organize your products into collections",
      fields: [
        {
          type: "input",
          name: "name",
          label: "Collection Name",
          placeholder: "e.g. Summer Release",
          required: true,
          autoFocus: true,
        },
        {
          type: "textarea",
          name: "description",
          label: "Description",
          placeholder: "Short collection description...",
          rows: 3,
          className: "col-span-2",
        },
      ],
      action: async ({ data }: { data: FormData }) => {
        const name = data.get("name");
        return { success: true, message: `Collection "${name || ""}" created successfully!` };
      },
    });
    setCreateOpen(true);
  };

  return (
    <CardWrapper
      label="Collections"
      description="Organize your products into collections"
      headerButton={
        <Button onClick={handleCreateCollection} variant="form" size="sm" className="gap-2">
          <Plus className="size-4" />
          Create
        </Button>
      }
      classNames={{
        cardWrapper: "min-h-content",
        contentWrapper: "flex flex-col items-center justify-center min-h-[400px]",
      }}
    >
      <div className="flex flex-col items-center justify-center text-center p-8">
        <div className="opacity-70 flex flex-col items-center gap-3">
          <EmptyFileIcon />
          <h3 className="text-lg font-medium text-foreground mt-2">No collections yet</h3>
          <p className="text-sm text-muted-foreground max-w-sm">
            Create collections to group related products together.
          </p>
          <div className="mt-4">
            <Button onClick={handleCreateCollection} variant="form" className="gap-2">
              <Plus className="size-4" />
              Create First Collection
            </Button>
          </div>
        </div>
      </div>
    </CardWrapper>
  );
};

export default Collections;
