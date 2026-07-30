import { NotImplementedCreate } from "@/routes/_backend/dashboard/-views/features/not-implemented-create";

const PromotionCreate = () => (
  <NotImplementedCreate
    feature="Promotions"
    title="Create Promotion"
    description="Set up a new discount or promotional campaign"
    fields={[
        {
          type: "input",
          name: "code",
          label: "Promotion Code",
          placeholder: "e.g. SUMMER20",
          required: true,
          autoFocus: true,
        },
        {
          type: "input",
          name: "discount",
          label: "Discount (%)",
          placeholder: "20",
        },
    ]}
  />
);

export default PromotionCreate;
