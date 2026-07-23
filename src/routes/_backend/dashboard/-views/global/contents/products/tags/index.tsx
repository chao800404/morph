import { Button } from "@/components/ui/button";
import { EmptyFileIcon } from "@/components/ui/icons/empty-file-icon";
import { useCreateStore } from "@/routes/_backend/dashboard/-views/features/global-create/use-create-store";
import { CardWrapper } from "@/routes/_backend/dashboard/-components/card-wrapper";
import { Plus } from "lucide-react";
import { useShallow } from "zustand/react/shallow";

const Tags = () => {
  const { setCreateData, setOpen: setCreateOpen } = useCreateStore(
    useShallow((state) => ({
      setCreateData: state.setCreateData,
      setOpen: state.setOpen,
    })),
  );

  const handleCreateTag = () => {
    setCreateData({
      title: "Create Tag",
      description: "Manage product tags and labels",
      fields: [
        {
          type: "input",
          name: "name",
          label: "Tag Name",
          placeholder: "e.g. New Arrival",
          required: true,
          autoFocus: true,
        },
      ],
      action: async ({ data }: { data: FormData }) => {
        const name = data.get("name");
        return { success: true, message: `Tag "${name || ""}" created successfully!` };
      },
    });
    setCreateOpen(true);
  };

  return (
    <CardWrapper
      label="Tags"
      description="Manage product tags and labels"
      headerButton={
        <Button onClick={handleCreateTag} variant="form" size="sm" className="gap-2">
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
          <h3 className="text-lg font-medium text-foreground mt-2">No tags yet</h3>
          <p className="text-sm text-muted-foreground max-w-sm">
            Create tags to categorize and filter your products easily.
          </p>
          <div className="mt-4">
            <Button onClick={handleCreateTag} variant="form" className="gap-2">
              <Plus className="size-4" />
              Create First Tag
            </Button>
          </div>
        </div>
      </div>
    </CardWrapper>
  );
};

export default Tags;
