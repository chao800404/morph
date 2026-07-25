import { Button } from "@/components/ui/button";
import { EmptyFileIcon } from "@/components/ui/icons/empty-file-icon";
import { useCreateStore } from "@/routes/_backend/dashboard/-views/features/global-create/use-create-store";
import { CardWrapper } from "@/routes/_backend/dashboard/-components/card-wrapper";
import { Plus } from "lucide-react";
import { useShallow } from "zustand/react/shallow";

const Orders = () => {
  const { setCreateData, setOpen: setCreateOpen } = useCreateStore(
    useShallow((state) => ({
      setCreateData: state.setCreateData,
      setOpen: state.setOpen,
    })),
  );

  const handleCreateOrder = () => {
    setCreateData({
      title: "Create Order",
      description: "Manually create a new customer order",
      fields: [
        {
          type: "input",
          name: "customerName",
          label: "Customer Name",
          placeholder: "e.g. John Doe",
          required: true,
          autoFocus: true,
        },
        {
          type: "input",
          name: "total",
          label: "Total Amount ($)",
          placeholder: "0.00",
        },
      ],
      action: async ({ data }: { data: FormData }) => {
        const name = data.get("customerName");
        return { success: true, message: `Order for "${name || ""}" created successfully!` };
      },
    });
    setCreateOpen(true);
  };

  return (
    <CardWrapper
      label="Orders"
      description="Manage customer orders and fulfillment"
      headerButton={
        <Button onClick={handleCreateOrder} variant="form" size="sm" className="gap-2">
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
          <h3 className="text-lg font-medium text-foreground mt-2">No orders yet</h3>
          <p className="text-sm text-muted-foreground max-w-sm">
            When customer orders are placed, they will appear here.
          </p>
          <div className="mt-4">
            <Button onClick={handleCreateOrder} variant="form" className="gap-2">
              <Plus className="size-4" />
              Create Order
            </Button>
          </div>
        </div>
      </div>
    </CardWrapper>
  );
};

export default Orders;
