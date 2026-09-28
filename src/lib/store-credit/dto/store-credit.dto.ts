export type StoreCreditTransactionType = "credit" | "debit";

export interface StoreCreditAccountDTO {
  id: string;
  customerId: string | null;
  customerEmail: string | null;
  customerName: string | null;
  currencyCode: string;
  status: "active" | "disabled";
  balance: number;
  totalCredits: number;
  totalDebits: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface StoreCreditTransactionDTO {
  id: string;
  accountId: string;
  type: StoreCreditTransactionType;
  amount: number;
  reference: string | null;
  referenceId: string | null;
  note: string | null;
  createdBy: string | null;
  createdAt: Date;
}

export interface StoreCreditAccountDetailDTO extends StoreCreditAccountDTO {
  transactions: StoreCreditTransactionDTO[];
}
