import { AssetGrid } from "@/components/asset/asset-grid";
import { AssetTile } from "@/components/asset/asset-tile";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { ProductDetailDTO } from "@/lib/product/dto/product.dto";
import { CardWrapper } from "@/routes/_backend/dashboard/-components/card-wrapper";
import { EditCardHeader } from "@/routes/_backend/dashboard/-components/edit-card/edit-card-header";
import { Star } from "lucide-react";

/**
 * The product's gallery.
 *
 * Not an `EditCard`: that renders label/value rows, and images are a grid. The
 * card shell, the `…` menu and the tiles are all the shared ones, so only the
 * grid's column rule is local.
 *
 * The thumbnail is marked rather than pulled out into its own card — it is one
 * of these images, and showing it twice would suggest a separate upload.
 *
 * `CardContent` carries no padding of its own, so the grid supplies it; without
 * the top value the first row sits on the header's divider.
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
    headerButton={<EditCardHeader onClickEdit={onEdit} />}
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
      <AssetGrid className="p-6">
        {product.assets.map((asset, index) => (
          <AssetTile
            key={asset.id}
            asset={asset}
            badge={
              // First by rank, which is what the thumbnail is. Reordering
              // happens in the editor, so this card only reports it.
              index === 0 ? (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="flex size-5 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-sm">
                      <Star className="size-3 fill-current" />
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>Thumbnail</TooltipContent>
                </Tooltip>
              ) : null
            }
          />
        ))}
      </AssetGrid>
    )}
  </CardWrapper>
);
