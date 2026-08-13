import type { ShippingRateProvider } from "./shipping-rate-provider";

export const manualShippingRateProvider: ShippingRateProvider = {
  id: "manual_manual",
  async calculate(input) {
    if (
      !input.data ||
      Array.isArray(input.data) ||
      typeof input.data !== "object"
    )
      return null;
    const amount = input.data.amount;
    return typeof amount === "number" && Number.isInteger(amount) && amount >= 0
      ? amount
      : null;
  },
};
