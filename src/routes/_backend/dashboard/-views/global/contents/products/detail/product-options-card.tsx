import { Badge } from "@/components/ui/badge";
import {
  EditCard,
  type EditCardField,
} from "@/routes/_backend/dashboard/-components/edit-card/edit-card";
import type { ProductDetailDTO } from "@/lib/product/dto/product.dto";

/**
 * The axes this product's variants are built from.
 *
 * One row per option, matching Medusa. Read-only: options come from the shared
 * library at /dashboard/product-options, and changing which values a product
 * uses would rebuild the variant matrix and drop the prices already set on it.
 */
export const ProductOptionsCard = ({
  product,
}: {
  product: ProductDetailDTO;
}) => {
  const fields: EditCardField[] = product.options.map((option) => ({
    key: option.id,
    label: option.title,
    displayValue: (
      <div className="flex flex-wrap justify-end gap-1">
        {option.values.map((value) => (
          <Badge key={value.id} variant="secondary">
            {value.value}
          </Badge>
        ))}
      </div>
    ),
  }));

  return (
    <EditCard
      id={`product-options-${product.id}`}
      title="Options"
      description="Defined in the shared option library, so they are fixed once variants exist."
      fields={fields}
    />
  );
};
