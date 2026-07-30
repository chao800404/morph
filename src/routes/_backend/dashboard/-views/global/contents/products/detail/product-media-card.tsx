import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { ProductDetailDTO } from "@/lib/product/dto/product.dto";
import { CardWrapper } from "@/routes/_backend/dashboard/-components/card-wrapper";
import { Star } from "lucide-react";

/**
 * The product's gallery.
 *
 * Not an `EditCard`: that renders label/value rows, and images are a grid. The
 * card shell is still the shared one, so only the grid is local.
 *
 * The thumbnail is marked rather than pulled out into its own card — it is one
 * of these images, and showing it twice would suggest a separate upload.
 */
export const ProductMediaCard = ({
  product,
  onEdit,
}: {
  product: ProductDetailDTO;
  onEdit: () => void;
}) => (
  <CardWrapper
    id="product-media"
    label="Media"
    headerButton={
      <Button variant="form" size="xs" onClick={onEdit}>
        Edit
      </Button>
    }
  >
    {product.assets.length === 0 ? (
      <div className="flex flex-col items-center gap-3 px-6 pb-8 pt-2 text-center">
        <p className="text-sm font-medium text-foreground">
          No media added yet
        </p>
        <p className="text-sm text-muted-foreground">
          Images are shown on the storefront and in the product list.
        </p>
        <Button variant="form" size="xs" onClick={onEdit}>
          Add media
        </Button>
      </div>
    ) : (
      <div className="grid grid-cols-[repeat(auto-fill,minmax(96px,1fr))] gap-4 px-6 pb-6">
        {product.assets.map((asset) => (
          <div
            key={asset.id}
            className="relative aspect-square overflow-hidden rounded-md-plus border bg-background"
          >
            <img
              src={asset.url}
              alt={asset.name}
              loading="lazy"
              className="size-full object-cover"
            />
            {asset.id === product.thumbnailAssetId ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="absolute left-2 top-2 flex size-5 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-sm">
                    <Star className="size-3 fill-current" />
                  </span>
                </TooltipTrigger>
                <TooltipContent>Thumbnail</TooltipContent>
              </Tooltip>
            ) : null}
          </div>
        ))}
      </div>
    )}
  </CardWrapper>
);
