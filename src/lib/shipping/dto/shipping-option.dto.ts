export interface StoreShippingOptionDTO {
  id: string;
  name: string;
  priceType: "flat" | "calculated";
  shippingProfileId: string | null;
  providerId: string | null;
  amount: number;
  currencyCode: string;
}
