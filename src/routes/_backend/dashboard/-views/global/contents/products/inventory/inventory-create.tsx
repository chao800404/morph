import { NotImplementedCreate } from "@/routes/_backend/dashboard/-views/features/not-implemented-create";

const InventoryCreate = () => (
  <NotImplementedCreate
    feature="Inventory management"
    title="Add Inventory Item"
    description="Track and manage stock levels across items"
    fields={[
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
    ]}
  />
);

export default InventoryCreate;
