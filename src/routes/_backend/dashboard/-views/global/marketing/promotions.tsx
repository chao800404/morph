import { CollectionCreateButton } from "@/routes/_backend/dashboard/-components/data-table-card";
import { EmptyFileIcon } from "@/components/ui/icons/empty-file-icon";
import { CardWrapper } from "@/routes/_backend/dashboard/-components/card-wrapper";

const Promotions = () => {


  return (
    <CardWrapper
      label="Promotions"
      description="Create discounts, coupons, and promotional campaigns"
      headerButton={
        <CollectionCreateButton slug="promotions" />
      }
      classNames={{
        cardWrapper: "h-auto",
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
            <CollectionCreateButton slug="promotions" />
          </div>
        </div>
      </div>
    </CardWrapper>
  );
};

export default Promotions;
