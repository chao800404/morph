import type { FulfillmentProvider } from "./fulfillment-provider";

export const manualFulfillmentProvider: FulfillmentProvider = {
  id: "manual_manual",
  async create(input) {
    return { ...input.data, reference: crypto.randomUUID() };
  },
  async cancel(input) {
    return input.data;
  },
};
