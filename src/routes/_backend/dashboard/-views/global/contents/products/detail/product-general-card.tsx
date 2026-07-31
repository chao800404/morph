import {
  EditCard,
  type EditCardField,
} from "@/routes/_backend/dashboard/-components/edit-card/edit-card";
import type { ProductDetailDTO } from "@/lib/product/dto/product.dto";
import { ProductStatusBadge } from "../components/product-status-badge";

/**
 * The product's own fields, and its status.
 *
 * The card title is the product name, so this is the one place the record's
 * name appears on the page — the breadcrumb carries it everywhere else.
 */
export const ProductGeneralCard = ({
  product,
  onEdit,
}: {
  product: ProductDetailDTO;
  onEdit: () => void;
}) => {
  const fields: EditCardField[] = [
    {
      key: "description",
      label: "Description",
      displayValue: product.description || undefined,
    },
    {
      key: "subtitle",
      label: "Subtitle",
      displayValue: product.subtitle || undefined,
    },
    // Shown with the leading slash it takes in a storefront URL, matching the
    // handle field's own prefix.
    { key: "handle", label: "Handle", displayValue: `/${product.handle}` },
    {
      key: "material",
      label: "Material",
      displayValue: product.material || undefined,
    },
    {
      key: "discountable",
      label: "Discountable",
      displayValue: product.discountable ? "True" : "False",
    },
  ];

  return (
    <EditCard
      id={`product-general-${product.id}`}
      title={product.title}
      fields={fields}
      onEdit={onEdit}
      headerActions={<ProductStatusBadge status={product.status} />}
    />
  );
};
