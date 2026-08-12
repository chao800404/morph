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
 * next. Types and tags are product child records, so their badges link into
 * the same addressable collection lifecycle as the other organization data.
 */
const LinkedBadge = ({ to, children }: { to: string; children: ReactNode }) => (
  <Badge variant="secondary" className="max-w-full truncate" asChild>
    <Link to={to}>{children}</Link>
  </Badge>
);

/** Undefined rather than a dash: the empty row belongs to `EditCard`. */
const badgeRow = (nodes: ReactNode[]): ReactNode =>
  nodes.length > 0 ? (
    <div className="flex flex-wrap gap-1">{nodes}</div>
  ) : undefined;

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
      displayValue: badgeRow(
        product.tags.map((tag) => (
          <LinkedBadge key={tag.id} to={`/dashboard/product-tags/${tag.id}`}>
            {tag.value}
          </LinkedBadge>
        )),
      ),
    },
    {
      key: "type",
      label: "Type",
      displayValue:
        product.typeId && product.typeValue ? (
          <LinkedBadge to={`/dashboard/product-types/${product.typeId}`}>
            {product.typeValue}
          </LinkedBadge>
        ) : undefined,
    },
    {
      key: "collection",
      label: "Collection",
      displayValue:
        product.collectionId && product.collectionTitle ? (
          <LinkedBadge to={`/dashboard/collections/${product.collectionId}`}>
            {product.collectionTitle}
          </LinkedBadge>
        ) : undefined,
    },
    {
      key: "categories",
      label: "Categories",
      displayValue: badgeRow(
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
    {
      key: "sales-channels",
      label: "Sales Channels",
      displayValue: badgeRow(
        product.salesChannels.map((channel) => (
          <LinkedBadge
            key={channel.id}
            to={`/dashboard/settings/sales-channels/${channel.id}`}
          >
            {channel.name}
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
