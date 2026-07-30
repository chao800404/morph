import {
  EditCard,
  type EditCardField,
} from "@/routes/_backend/dashboard/-components/edit-card/edit-card";
import type { ProductDetailDTO } from "@/lib/product/dto/product.dto";

/**
 * Shipping and customs attributes.
 *
 * They live on the product as defaults; a variant may override each one. The
 * card is read-only until a variant-level editor exists, because editing them
 * here without showing which variants override them would be misleading.
 */
const measurement = (value: number | null, unit: string) =>
  value === null ? "—" : `${value} ${unit}`;

export const ProductAttributesCard = ({
  product,
}: {
  product: ProductDetailDTO;
}) => {
  const fields: EditCardField[] = [
    { key: "height", label: "Height", displayValue: measurement(product.height, "mm") },
    { key: "width", label: "Width", displayValue: measurement(product.width, "mm") },
    { key: "length", label: "Length", displayValue: measurement(product.length, "mm") },
    { key: "weight", label: "Weight", displayValue: measurement(product.weight, "g") },
    { key: "midCode", label: "MID code", displayValue: product.midCode || "—" },
    { key: "hsCode", label: "HS code", displayValue: product.hsCode || "—" },
    {
      key: "originCountry",
      label: "Country of origin",
      displayValue: product.originCountry || "—",
    },
  ];

  return (
    <EditCard
      id={`product-attributes-${product.id}`}
      title="Attributes"
      fields={fields}
    />
  );
};
