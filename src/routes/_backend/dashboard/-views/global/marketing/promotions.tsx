import { Button } from "@/components/ui/button";
import { EmptyFileIcon } from "@/components/ui/icons/empty-file-icon";
import { useCreateStore } from "@/routes/_backend/dashboard/-views/features/global-create/use-create-store";
import { CardWrapper } from "@/routes/_backend/dashboard/-components/card-wrapper";
import { Plus } from "lucide-react";
import { useShallow } from "zustand/react/shallow";

const Promotions = () => {
  const { setCreateData, setOpen: setCreateOpen } = useCreateStore(
    useShallow((state) => ({
      setCreateData: state.setCreateData,
      setOpen: state.setOpen,
    })),
  );

  const handleCreatePromotion = () => {
    setCreateData({
      title: "Create Promotion",
      description: "Launch discounts and special promotional campaigns",
      fields: [
        {
          type: "input",
          name: "title",
          label: "Promotion Title",
          placeholder: "e.g. Summer Sale 20%",
          required: true,
          autoFocus: true,
        },
        {
          type: "input",
          name: "code",
          label: "Promo Code",
          placeholder: "SUMMER20",
        },
      ],
      action: async ({ data }: { data: FormData }) => {
        const title = data.get("title");
        return { success: true, message: `Promotion "${title || ""}" created successfully!` };
      },
    });
    setCreateOpen(true);
  };

  return (
    <CardWrapper
      label="Promotions"
      description="Create discounts, coupons, and promotional campaigns"
      headerButton={
        <Button onClick={handleCreatePromotion} variant="form" size="sm" className="gap-2">
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
          <h3 className="text-lg font-medium text-foreground mt-2">No promotions yet</h3>
          <p className="text-sm text-muted-foreground max-w-sm">
            Launch discount campaigns and special offers for your store.
          </p>
          <div className="mt-4">
            <Button onClick={handleCreatePromotion} variant="form" className="gap-2">
              <Plus className="size-4" />
              Create First Promotion
            </Button>
          </div>
        </div>
      </div>
    </CardWrapper>
  );
};

export default Promotions;
