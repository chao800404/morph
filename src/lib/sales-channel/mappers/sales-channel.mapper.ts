import { salesChannels } from "@/db/sales-channel.schema";
import type { SalesChannelDTO } from "../dto/sales-channel.dto";

export type SalesChannelRow = typeof salesChannels.$inferSelect;

export const toSalesChannelDTO = (row: SalesChannelRow): SalesChannelDTO => ({
  id: row.id,
  name: row.name,
  type: row.type,
  description: row.description ?? null,
  isDisabled: row.isDisabled,
  metadata: row.metadata ?? {},
  createdAt: new Date(row.createdAt),
  updatedAt: new Date(row.updatedAt),
});
