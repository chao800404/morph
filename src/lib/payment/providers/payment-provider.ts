import type { Metadata } from "@/db/json";

export interface PaymentProviderInput {
  amount: number;
  currencyCode: string;
  context: Metadata;
  data: Metadata;
}

export interface PaymentProviderResult {
  status:
    | "pending"
    | "requires_more"
    | "authorized"
    | "captured"
    | "refunded"
    | "canceled"
    | "error";
  data: Metadata;
}

export interface PaymentProvider {
  readonly id: string;
  initiate(input: PaymentProviderInput): Promise<PaymentProviderResult>;
  authorize(input: PaymentProviderInput): Promise<PaymentProviderResult>;
  capture(input: PaymentProviderInput): Promise<PaymentProviderResult>;
  cancel(input: PaymentProviderInput): Promise<PaymentProviderResult>;
  refund(input: PaymentProviderInput): Promise<PaymentProviderResult>;
}
