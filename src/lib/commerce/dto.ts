import type {
  ApplicationMethodAllocation,
  ApplicationMethodTargetType,
  ApplicationMethodType,
  OrderStatus,
  PromotionStatus,
  PromotionType,
} from "@/db/schema";
import type { Metadata } from "@/db/json";

export interface OrderListDTO {
  id: string;
  displayId: number;
  status: OrderStatus;
  email: string | null;
  currencyCode: string;
  isDraftOrder: boolean;
  total: number;
  createdAt: string;
  updatedAt: string;
}

export interface OrderDetailDTO extends OrderListDTO {
  metadata: Metadata;
  customerId: string | null;
  regionId: string | null;
  salesChannelId: string | null;
  items: Array<{
    id: string;
    title: string;
    thumbnail: string | null;
    sku: string | null;
    quantity: number;
    fulfilledQuantity: number;
    unitPrice: number;
  }>;
  shippingAddress: AddressDTO | null;
  billingAddress: AddressDTO | null;
}

export interface AddressDTO {
  firstName: string | null;
  lastName: string | null;
  company: string | null;
  address1: string | null;
  address2: string | null;
  city: string | null;
  province: string | null;
  postalCode: string | null;
  countryCode: string | null;
  phone: string | null;
}

export interface PromotionListDTO {
  id: string;
  code: string;
  type: PromotionType;
  status: PromotionStatus;
  isAutomatic: boolean;
  limit: number | null;
  used: number;
  methodType: ApplicationMethodType | null;
  targetType: ApplicationMethodTargetType | null;
  value: number | null;
  currencyCode: string | null;
  updatedAt: string;
}

export interface PromotionDetailDTO extends PromotionListDTO {
  metadata: Metadata;
  isTaxInclusive: boolean;
  allocation: ApplicationMethodAllocation | null;
  maxQuantity: number | null;
  applyToQuantity: number | null;
  buyRulesMinQuantity: number | null;
  rules: PromotionRuleDTO[];
  targetRules: PromotionRuleDTO[];
  buyRules: PromotionRuleDTO[];
  campaign: {
    id: string;
    name: string;
    description: string | null;
    identifier: string;
    startsAt: string | null;
    endsAt: string | null;
  } | null;
  createdAt: string;
}

export interface PromotionRuleDTO {
  attribute: string;
  operator: "gte" | "lte" | "gt" | "lt" | "eq" | "ne" | "in";
  values: string[];
}

export interface PromotionCampaignDTO {
  id: string;
  name: string;
  identifier: string;
  startsAt: string | null;
  endsAt: string | null;
}
