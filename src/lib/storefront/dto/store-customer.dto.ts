import type { OrderListDTO, OrderItemDTO } from "@/lib/order/dto/order.dto";

export interface StoreCustomerOrderPageDTO {
  orders: OrderListDTO[];
  count: number;
  offset: number;
  limit: number;
}

export interface StoreCustomerOrderDetailDTO {
  order: OrderListDTO & {
    creditLines: Array<{
      amount: number;
      reference: string | null;
    }>;
  };
  items: OrderItemDTO[];
  count: number;
  offset: number;
  limit: number;
}
