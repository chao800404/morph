import { orderAddresses, orderItems, orderLineItems, orders } from "@/db/order.schema";

export interface OrderExportItemDTO {
  order: typeof orders.$inferSelect;
  total: number;
  summary: unknown;
  shippingAddress: typeof orderAddresses.$inferSelect | null;
  billingAddress: typeof orderAddresses.$inferSelect | null;
  items: Array<{
    lineItem: typeof orderLineItems.$inferSelect;
    state: typeof orderItems.$inferSelect;
  }>;
}
