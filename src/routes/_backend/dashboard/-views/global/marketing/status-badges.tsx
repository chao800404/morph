import { StatusBadge } from "@/components/ui/status-badge";
import type { OrderStatus, PromotionStatus } from "@/db/schema";

export const OrderStatusBadge = ({ status, variant = "default" }: { status: OrderStatus; variant?: "default" | "plain" }) => {
  const config = {
    pending: ["amber", "Pending"], completed: ["green", "Completed"], draft: ["grey", "Draft"],
    archived: ["grey", "Archived"], canceled: ["red", "Canceled"], requires_action: ["amber", "Requires action"],
  }[status] as ["green" | "grey" | "red" | "amber", string];
  return <StatusBadge variant={variant} color={config[0]}>{config[1]}</StatusBadge>;
};

export const PromotionStatusBadge = ({ status, variant = "default" }: { status: PromotionStatus; variant?: "default" | "plain" }) => {
  const config = { active: ["green", "Active"], draft: ["grey", "Draft"], inactive: ["red", "Inactive"] }[status] as ["green" | "grey" | "red", string];
  return <StatusBadge variant={variant} color={config[0]}>{config[1]}</StatusBadge>;
};
