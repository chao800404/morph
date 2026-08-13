import type { PaymentProvider } from "./payment-provider";

export const manualPaymentProvider: PaymentProvider = {
  id: "pp_manual_manual",
  async initiate(input) {
    return {
      status: "pending",
      data: { ...input.data, reference: crypto.randomUUID() },
    };
  },
  async authorize(input) {
    return { status: "authorized", data: input.data };
  },
  async capture(input) {
    return { status: "captured", data: input.data };
  },
  async cancel(input) {
    return { status: "canceled", data: input.data };
  },
  async refund(input) {
    return { status: "refunded", data: input.data };
  },
};
