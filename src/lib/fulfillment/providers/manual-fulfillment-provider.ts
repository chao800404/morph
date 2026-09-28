import type { FulfillmentProvider } from "./fulfillment-provider";

export const manualFulfillmentProvider: FulfillmentProvider = {
  id: "manual_manual",
  name: "Manual fulfillment",
  async create(input) {
    return {
      data: { ...input.data, reference: crypto.randomUUID() },
      labels: [],
    };
  },
  async cancel(input) {
    return input.data;
  },
};
