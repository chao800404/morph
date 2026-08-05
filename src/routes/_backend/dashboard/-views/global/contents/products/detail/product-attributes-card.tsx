import {
  EditCard,
  type EditCardField,
} from "@/routes/_backend/dashboard/-components/edit-card/edit-card";
import type { ProductDetailDTO } from "@/lib/product/dto/product.dto";

/**
 * Shipping and customs attributes.
 *
 * They live on the product as defaults; a variant may override each one.
 */
/** `EditCard` renders its own placeholder when a row has nothing to show. */
const measurement = (value: number | null, unit: string) =>
  value === null ? undefined : `${value} ${unit}`;

export const ProductAttributesCard = ({
  product,
  onEdit,
}: {
  product: ProductDetailDTO;
  onEdit: () => void;
}) => {
  const fields: EditCardField[] = [
    { key: "height", label: "Height", displayValue: measurement(product.height, "mm") },
    { key: "width", label: "Width", displayValue: measurement(product.width, "mm") },
    { key: "length", label: "Length", displayValue: measurement(product.length, "mm") },
    { key: "weight", label: "Weight", displayValue: measurement(product.weight, "g") },
    { key: "midCode", label: "MID code", displayValue: product.midCode || undefined },
    { key: "hsCode", label: "HS code", displayValue: product.hsCode || undefined },
    {
      key: "originCountry",
      label: "Country of origin",
      displayValue: product.originCountry || undefined,
    },
  ];

  return (
    <EditCard
      id={`product-attributes-${product.id}`}
      title="Attributes"
      fields={fields}
      onEdit={onEdit}
    />
  );
};
