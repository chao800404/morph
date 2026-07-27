import { AssetBlockMap } from "@/components/asset/asset-block-map";
import {
  Carousel,
  type CarouselApi,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
} from "@/components/ui/carousel";
import { NextArrowIcon } from "@/components/ui/icons/next-arrow-icon";
import { PreviousArrowIcon } from "@/components/ui/icons/previous-arrow-icon";
import { cn } from "@/lib/utils";
import { useEffect, useState } from "react";
import type { PreviewAsset } from "../asset-preview.types";

interface AssetPreviewCarouselProps {
  assets: PreviewAsset[];
  selectedIndex: number;
  onSelect: (assetId: string) => void;
}

export const AssetPreviewCarousel = ({
  assets,
  selectedIndex,
  onSelect,
}: AssetPreviewCarouselProps) => {
  const [carouselApi, setCarouselApi] = useState<CarouselApi>();

  useEffect(() => {
    carouselApi?.scrollTo(selectedIndex);
  }, [carouselApi, selectedIndex]);

  return (
    <Carousel
      setApi={setCarouselApi}
      opts={{ align: "center", loop: false }}
      className="mx-auto w-fit max-w-sm"
    >
      <CarouselContent className="-ml-2">
        {assets.map((asset, index) => (
          <CarouselItem key={asset.id} className="basis-8 not-last:pl-1.5">
            <button
              type="button"
              onClick={() => onSelect(asset.id)}
              aria-label={`View ${asset.name}`}
              aria-current={selectedIndex === index}
              className={cn(
                "relative h-full w-fit cursor-pointer overflow-hidden transition-all",
                selectedIndex === index ? "opacity-100" : "opacity-20",
              )}
            >
              <AssetBlockMap
                variant="sm"
                type="asset"
                fileType={asset.fileType}
                src={asset.src}
                alt={asset.alt || asset.name}
                extension={asset.extension}
              />
            </button>
          </CarouselItem>
        ))}
      </CarouselContent>
      <CarouselPrevious variant="none">
        <PreviousArrowIcon className="size-3" />
      </CarouselPrevious>
      <CarouselNext variant="none">
        <NextArrowIcon className="size-3" />
      </CarouselNext>
    </Carousel>
  );
};
