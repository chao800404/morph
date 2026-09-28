import type { StoreCreditTransactionDTO } from "@/lib/store-credit/dto/store-credit.dto";

export type GiftCardStatus = "active" | "disabled" | "expired" | "depleted";

export interface GiftCardDTO {
  id: string;
  currencyCode: string;
  status: GiftCardStatus;
  initialValue: number;
  balance: number;
  totalCredits: number;
  totalDebits: number;
  expiresAt: string | null;
  note: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface GiftCardDetailDTO extends GiftCardDTO {
  transactions: StoreCreditTransactionDTO[];
}
