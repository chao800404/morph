export interface ShippingOptionTypeDTO {
  id: string;
  label: string;
  code: string;
  description: string | null;
  shippingOptionCount: number;
  createdAt: string;
  updatedAt: string;
}
