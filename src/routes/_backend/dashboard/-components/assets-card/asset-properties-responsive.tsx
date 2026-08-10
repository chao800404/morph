import { useMediaQuery } from "@/hooks/use-media-query";
import { useAssetsStore } from "@/routes/_backend/dashboard/-views/global/contents/assets/stores/assets.store";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from "@/components/ui/sheet";
import { useShallow } from "zustand/react/shallow";
import { AssetPropertyCard } from "./asset-property-card";

/**
 * Assets keeps Properties beside the explorer when there is enough room. On
 * narrower screens the same card becomes an on-demand sheet so the table does
 * not lose a large part of its working width.
 */
export const AssetPropertiesResponsive = () => {
  const isDesktop = useMediaQuery("(min-width: 1280px)");
  const { activeItem, setActiveItem } = useAssetsStore(
    useShallow((state) => ({
      activeItem: state.activeItem,
      setActiveItem: state.setActiveItem,
    })),
  );

  return (
    <>
      <div className="hidden xl:block">
        <AssetPropertyCard />
      </div>

      <Sheet
        open={!isDesktop && Boolean(activeItem)}
        onOpenChange={(open) => {
          if (!open) setActiveItem(undefined);
        }}
      >
        <SheetContent
          side="right"
          className="w-[min(28rem,calc(100vw-1rem))] max-w-none border-l-0 bg-transparent p-2 shadow-none [&>#card-property]:h-full"
        >
          <SheetTitle className="sr-only">Asset properties</SheetTitle>
          <SheetDescription className="sr-only">
            View properties for the selected asset or folder.
          </SheetDescription>
          <AssetPropertyCard />
        </SheetContent>
      </Sheet>
    </>
  );
};
