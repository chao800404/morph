import { Button } from "@/components/ui/button";
import { EmptyFileIcon } from "@/components/ui/icons/empty-file-icon";
import { CardWrapper } from "@/routes/_backend/dashboard/-components/card-wrapper";
import { useCreateStore } from "@/routes/_backend/dashboard/-views/features/global-create/use-create-store";
import { Plus } from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { notImplementedAction } from "@/lib/not-implemented-action";

const Options = () => {
  const { setCreateData, setOpen: setCreateOpen } = useCreateStore(
    useShallow((state) => ({
      setCreateData: state.setCreateData,
      setOpen: state.setOpen,
    })),
  );

  const handleCreateOption = () => {
    setCreateData({
      title: "Create Product Option",
      description: "Create a new product option and manage its values.",
      fields: [
        {
          type: "input",
          name: "title",
          label: "Title",
          placeholder: "e.g. Size, Color, Material",
          required: true,
          autoFocus: true,
        },
        {
          type: "option-values",
          name: "values",
          label: "Values",
          placeholder: "Type value and press Enter...",
        },
      ],
      action: notImplementedAction("Product options"),
    });
    setCreateOpen(true);
  };

  return (
    <CardWrapper
      label="Options"
      description="Manage product options and variant attributes (e.g. Size, Color)"
      headerButton={
        <Button
          onClick={handleCreateOption}
          variant="form"
          size="sm"
          className="gap-2"
        >
          <Plus className="size-4" />
          Create
        </Button>
      }
      classNames={{
        cardWrapper: "min-h-content",
        contentWrapper:
          "flex flex-col items-center justify-center min-h-[400px]",
      }}
    >
      <div className="flex flex-col items-center justify-center text-center p-8">
        <div className="opacity-70 flex flex-col items-center gap-3">
          <EmptyFileIcon />
          <h3 className="text-lg font-medium text-foreground mt-2">
            No product options yet
          </h3>
          <p className="text-sm text-muted-foreground max-w-sm">
            Create options to define customizable variants for your products
            such as Size, Color, and Material.
          </p>
          <div className="mt-4">
            <Button
              onClick={handleCreateOption}
              variant="form"
              className="gap-2"
            >
              <Plus className="size-4" />
              Create First Option
            </Button>
          </div>
        </div>
      </div>
    </CardWrapper>
  );
};

export default Options;
