export interface CartLineItemDTO {
  id: string;
  variantId: string | null;
  productId: string | null;
  title: string;
  variantTitle: string | null;
  productHandle: string | null;
  thumbnail: string | null;
  quantity: number;
  unitPrice: number;
  subtotal: number;
  discountTotal: number;
  taxTotal: number;
  total: number;
}

export interface CartAddressDTO {
  id: string;
  company: string | null;
  firstName: string | null;
  lastName: string | null;
  address1: string | null;
  address2: string | null;
  city: string | null;
  countryCode: string | null;
  province: string | null;
  postalCode: string | null;
  phone: string | null;
}

export interface CartShippingMethodDTO {
  id: string;
  shippingOptionId: string | null;
  name: string;
  amount: number;
  discountTotal: number;
  taxTotal: number;
  total: number;
}

export type CartAddressInput = Omit<CartAddressDTO, "id">;

export interface CartDTO {
  id: string;
  regionId: string;
  salesChannelId: string;
  currencyCode: string;
  locale: string | null;
  email: string | null;
  shippingAddress: CartAddressDTO | null;
  billingAddress: CartAddressDTO | null;
  completedAt: string | null;
  items: CartLineItemDTO[];
  shippingMethods: CartShippingMethodDTO[];
  promotions: Array<{
    id: string;
    code: string;
    isAutomatic: boolean;
  }>;
  itemSubtotal: number;
  itemDiscountTotal: number;
  itemTaxTotal: number;
  shippingSubtotal: number;
  shippingDiscountTotal: number;
  shippingTaxTotal: number;
  creditTotal: number;
  subtotal: number;
  taxTotal: number;
  discountTotal: number;
  total: number;
  createdAt: string;
  updatedAt: string;
}
