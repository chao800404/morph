import { RouterLink } from "@/components/router-link";
import { cn } from "@/lib/utils";
import { Play, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { CardWrapper } from "./card-wrapper";

export interface ResourceLinkCardItem {
  href: string;
  icon: LucideIcon;
  title: ReactNode;
  description?: ReactNode;
  onPreload?: () => void;
}

export const ResourceLinkCard = ({
  id,
  title,
  description,
  item,
  headerAction,
  className,
}: {
  id: string;
  title: ReactNode;
  description?: ReactNode;
  item: ResourceLinkCardItem;
  headerAction?: ReactNode;
  className?: string;
}) => {
  const Icon = item.icon;
  return (
    <CardWrapper
      id={id}
      label={title}
      description={description}
      headerButton={headerAction}
      classNames={{
        cardWrapper: className,
        cardHeader: "py-5 [.border-b]:pb-5",
        headerWrapper:
          "[&_[data-slot=card-title]]:text-lg [&_[data-slot=card-title]]:font-semibold",
        contentWrapper: "border-t-0",
      }}
    >
      <div
        className="px-3 pb-2"
        onPointerEnter={item.onPreload}
        onFocus={item.onPreload}
        onTouchStart={item.onPreload}
      >
        <RouterLink
          href={item.href}
          className={cn(
            "group flex min-w-0 items-center gap-3 rounded-lg border border-border/80 bg-component-secondary py-3 pl-3 pr-4 text-foreground shadow-resource-link transition-colors",
            "hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          )}
        >
          <span className="flex size-8 shrink-0 items-center justify-center rounded-md border border-border/80 bg-muted/50 shadow-sm ring-1 ring-inset ring-foreground/5">
            <Icon className="size-4 text-muted-foreground" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-semibold leading-4">
              {item.title}
            </span>
            {item.description ? (
              <span className="mt-1 block truncate text-sm leading-4 text-muted-foreground">
                {item.description}
              </span>
            ) : null}
          </span>
          <Play className="size-3 shrink-0 fill-current text-muted-foreground transition-transform group-hover:translate-x-0.5" />
        </RouterLink>
      </div>
    </CardWrapper>
  );
};
