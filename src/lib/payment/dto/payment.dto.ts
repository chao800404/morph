export interface PaymentSessionDTO {
  id: string;
  providerId: string;
  amount: number;
  currencyCode: string;
  status: string;
  data: Record<string, unknown>;
}

export interface PaymentCollectionDTO {
  id: string;
  amount: number;
  currencyCode: string;
  status: string;
  authorizedAmount: number | null;
  capturedAmount: number | null;
  refundedAmount: number | null;
  providerIds: string[];
  sessions: PaymentSessionDTO[];
}
