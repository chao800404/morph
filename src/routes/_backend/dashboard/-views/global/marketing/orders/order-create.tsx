import { NotImplementedCreate } from "@/routes/_backend/dashboard/-views/features/not-implemented-create";

const OrderCreate = () => (
  <NotImplementedCreate
    feature="Order creation"
    title="Create Order"
    description="Manually create a new customer order"
    fields={[
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
    ]}
  />
);

export default OrderCreate;
