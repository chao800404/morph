import { CollectionCreateButton } from "@/routes/_backend/dashboard/-components/data-table-card";
import { EmptyFileIcon } from "@/components/ui/icons/empty-file-icon";
import { CardWrapper } from "@/routes/_backend/dashboard/-components/card-wrapper";

const Orders = () => {


  return (
    <CardWrapper
      label="Orders"
      description="Manage customer orders and fulfillment"
      headerButton={
        <CollectionCreateButton slug="orders" />
      }
      classNames={{
        cardWrapper: "h-auto",
        contentWrapper: "flex flex-col items-center justify-center min-h-[400px]",
      }}
    >
      <div className="flex flex-col items-center justify-center text-center p-8">
        <div className="opacity-70 flex flex-col items-center gap-3">
          <EmptyFileIcon />
          <h3 className="text-lg font-medium text-foreground mt-2">No orders yet</h3>
          <p className="text-sm text-muted-foreground max-w-sm">
            When customer orders are placed, they will appear here.
          </p>
          <div className="mt-4">
            <CollectionCreateButton slug="orders" />
          </div>
        </div>
      </div>
    </CardWrapper>
  );
};

export default Orders;
