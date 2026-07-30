import { Badge } from "@/components/ui/badge";
import {
  EditCard,
  type EditCardField,
} from "@/routes/_backend/dashboard/-components/edit-card/edit-card";
import type { ProductDetailDTO } from "@/lib/product/dto/product.dto";
import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";

/**
 * Where the product sits in the catalogue.
 *
 * Every value is a link to the record it names, matching Medusa: an author who
 * opens a product to check which collection it is in usually wants to go there
 * next. Type and tags are not addressable in this dashboard yet, so those two
 * stay plain badges rather than links that would 404.
 */
const LinkedBadge = ({ to, children }: { to: string; children: ReactNode }) => (
  <Badge variant="secondary" className="max-w-full truncate" asChild>
    <Link to={to}>{children}</Link>
  </Badge>
);

const emptyOr = (nodes: ReactNode[]): ReactNode =>
  nodes.length > 0 ? (
    <div className="flex flex-wrap justify-end gap-1">{nodes}</div>
  ) : (
    "—"
  );

export const ProductOrganizationCard = ({
  product,
  onEdit,
}: {
  product: ProductDetailDTO;
  onEdit: () => void;
}) => {
  const fields: EditCardField[] = [
    {
      key: "tags",
      label: "Tags",
      displayValue: emptyOr(
        product.tags.map((tag) => (
          <Badge key={tag.id} variant="secondary">
            {tag.value}
          </Badge>
        )),
      ),
    },
    {
      key: "type",
      label: "Type",
      displayValue: product.typeValue ? (
        <Badge variant="secondary">{product.typeValue}</Badge>
      ) : (
        "—"
      ),
    },
    {
      key: "collection",
      label: "Collection",
      displayValue:
        product.collectionId && product.collectionTitle ? (
          <LinkedBadge to={`/dashboard/collections/${product.collectionId}`}>
            {product.collectionTitle}
          </LinkedBadge>
        ) : (
          "—"
        ),
    },
    {
      key: "categories",
      label: "Categories",
      displayValue: emptyOr(
        product.categories.map((category) => (
          <LinkedBadge
            key={category.id}
            to={`/dashboard/categories/${category.id}`}
          >
            {category.name}
          </LinkedBadge>
        )),
      ),
    },
  ];

  return (
    <EditCard
      id={`product-organization-${product.id}`}
      title="Organization"
      fields={fields}
      onEdit={onEdit}
    />
  );
};
