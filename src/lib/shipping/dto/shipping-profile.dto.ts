export type ShippingProfileType = "default" | "gift_card" | "custom";

export interface ShippingProfileDTO {
  id: string;
  name: string;
  type: ShippingProfileType;
  productCount: number;
  shippingOptionCount: number;
  createdAt: string;
  updatedAt: string;
}
