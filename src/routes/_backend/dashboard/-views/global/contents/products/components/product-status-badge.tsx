import { StatusBadge } from "@/components/ui/status-badge";
import type { ProductStatus } from "@/db/product.schema";

const PRODUCT_STATUS_CONFIG: Record<
  ProductStatus,
  { color: "green" | "grey" | "red"; label: string }
> = {
  published: { color: "green", label: "Published" },
  draft: { color: "grey", label: "Draft" },
  archived: { color: "red", label: "Archived" },
};

export const ProductStatusBadge = ({
  status,
  variant = "default",
}: {
  status: ProductStatus;
  variant?: "default" | "plain";
}) => {
  const config = PRODUCT_STATUS_CONFIG[status] ?? {
    color: "grey",
    label: status,
  };
  return (
    <StatusBadge variant={variant} color={config.color}>
      {config.label}
    </StatusBadge>
  );
};
