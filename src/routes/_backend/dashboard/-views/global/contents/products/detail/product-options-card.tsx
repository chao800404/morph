import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { ProductDetailDTO } from "@/lib/product/dto/product.dto";
import {
  EditCard,
  type EditCardField,
} from "@/routes/_backend/dashboard/-components/edit-card/edit-card";
import { Link } from "@tanstack/react-router";
import { SquareArrowOutUpRight } from "lucide-react";

/**
 * The axes this product's variants are built from.
 *
 * One row per option, matching Medusa. Each row links to the shared library,
 * because that is where a value is added or renamed — for every product using
 * the option, not just this one.
 *
 * Edit only adds axes. Removing one would orphan the option value ids every
 * existing variant stores, so it is not offered here.
 */
export const ProductOptionsCard = ({
  product,
  onEdit,
}: {
  product: ProductDetailDTO;
  onEdit: () => void;
}) => {
  const fields: EditCardField[] = product.options.map((option) => ({
    key: option.id,
    label: option.title,
    // Values start where every other row's value starts; the link sits at the
    // far edge, so the icon column lines up down the card.
    displayValue: (
      <div className="flex w-full items-center justify-between gap-2">
        <div className="flex flex-wrap gap-1">
          {option.values.map((value) => (
            <Badge key={value.id} variant="secondary">
              {value.value}
            </Badge>
          ))}
        </div>
        <Tooltip>
          <TooltipTrigger asChild>
            <Link
              to="/dashboard/$slug/$id"
              params={{ slug: "product-options", id: option.id }}
              aria-label={`Open the ${option.title} option`}
              className="shrink-0 text-muted-foreground transition-colors hover:text-foreground"
            >
              <SquareArrowOutUpRight className="size-4" />
            </Link>
          </TooltipTrigger>
          <TooltipContent>Open in the option library</TooltipContent>
        </Tooltip>
      </div>
    ),
  }));

  return (
    <EditCard
      id={`product-options-${product.id}`}
      title="Options"
      description="Defined in the shared option library. Adding an axis leaves existing variants without a value on it."
      fields={fields}
      onEdit={onEdit}
    />
  );
};
