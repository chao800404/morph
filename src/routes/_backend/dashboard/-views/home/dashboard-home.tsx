import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { productQueries } from "@queries/product.queries";
import { salesChannelQueries } from "@queries/sales-channel.queries";
import { useSuspenseQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
  ArrowRight,
  Boxes,
  ChevronDown,
  CircleDollarSign,
  Image,
  ImageIcon,
  PackagePlus,
  Settings2,
} from "lucide-react";
import type {
  FocusEvent as ReactFocusEvent,
  PointerEvent as ReactPointerEvent,
} from "react";
import {
  DASHBOARD_HOME_CHANNEL_PARAMS,
  DASHBOARD_HOME_PRODUCT_PARAMS,
  DASHBOARD_PRODUCT_CARD_TRANSFORMS,
} from "./dashboard-home.config";

const QUICK_LINKS = [
  {
    title: "Add a product",
    description: "Create the next item in your catalogue.",
    scope: "create" as const,
    slug: "products",
    icon: PackagePlus,
  },
  {
    title: "Manage media",
    description: "Upload and organize product assets.",
    scope: "global" as const,
    slug: "assets",
    icon: ImageIcon,
  },
  {
    title: "Review sales channels",
    description: "Control where products are available.",
    scope: "settings" as const,
    slug: "sales-channels",
    icon: Boxes,
  },
  {
    title: "Store settings",
    description: "Update your store, currency, and defaults.",
    scope: "settings" as const,
    slug: "store",
    icon: Settings2,
  },
];

const GENERAL_LINKS = [
  { label: "Products", scope: "global" as const, slug: "products" },
  { label: "Orders", scope: "global" as const, slug: "orders" },
  { label: "Promotions", scope: "global" as const, slug: "promotions" },
  { label: "Assets", scope: "global" as const, slug: "assets" },
  {
    label: "Sales channels",
    scope: "settings" as const,
    slug: "sales-channels",
  },
  { label: "Store settings", scope: "settings" as const, slug: "store" },
];

const EmptyStorefrontPreview = () => (
  <div className="grid flex-1 grid-rows-[1.05fr_1fr] gap-2 bg-card p-2">
    <div className="rounded-md bg-accent/80" />
    <div className="grid grid-cols-4 gap-2">
      {Array.from({ length: 4 }, (_, index) => (
        <div key={index} className="rounded-md bg-accent/80" />
      ))}
    </div>
  </div>
);

const EmptyProductPreview = () => (
  <div className="flex size-full items-center justify-center rounded-[inherit] border border-dashed border-muted-foreground/40 bg-card text-muted-foreground shadow-inner">
    <Image className="size-5" aria-hidden="true" />
  </div>
);

const getThemePreviewCard = (trigger: HTMLButtonElement) =>
  trigger.querySelector<HTMLElement>("[data-theme-preview-card]");

const prefersReducedMotion = () =>
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const handleThemePreviewPointerMove = (
  event: ReactPointerEvent<HTMLButtonElement>,
) => {
  if (prefersReducedMotion()) return;

  const bounds = event.currentTarget.getBoundingClientRect();
  const x = (event.clientX - bounds.left) / bounds.width - 0.5;
  const y = (event.clientY - bounds.top) / bounds.height - 0.5;
  const rotateX = 1 - y * 8;
  const rotateY = x * 8;
  const card = getThemePreviewCard(event.currentTarget);

  if (card) {
    card.style.transform = `rotateX(${rotateX.toFixed(2)}deg) rotateY(${rotateY.toFixed(2)}deg) translateY(-0.375rem) scale(1.015)`;
  }
};

const resetThemePreviewTransform = (
  event:
    | ReactPointerEvent<HTMLButtonElement>
    | ReactFocusEvent<HTMLButtonElement>,
) => {
  const card = getThemePreviewCard(event.currentTarget);
  card?.style.removeProperty("transform");
};

const handleThemePreviewFocus = (
  event: ReactFocusEvent<HTMLButtonElement>,
) => {
  if (prefersReducedMotion()) return;

  const card = getThemePreviewCard(event.currentTarget);
  if (card) {
    card.style.transform =
      "rotateX(1deg) rotateY(-2deg) translateY(-0.375rem) scale(1.015)";
  }
};

export default function DashboardHome() {
  const productResult = useSuspenseQuery(
    productQueries.list(DASHBOARD_HOME_PRODUCT_PARAMS),
  ).data;
  const channelResult = useSuspenseQuery(
    salesChannelQueries.list(DASHBOARD_HOME_CHANNEL_PARAMS),
  ).data;

  const products = productResult.success
    ? productResult.data.products.slice(0, 3)
    : [];
  const storefront = channelResult.success
    ? channelResult.data.salesChannels.find(
        (channel) => channel.type === "storefront" && !channel.isDisabled,
      )
    : undefined;

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col items-center gap-8 py-8 sm:py-12">
      <section
        aria-label="Online store preview"
        className="relative flex w-full max-w-lg justify-center pb-[3.75rem] pt-2 [perspective:900px]"
      >
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              className="group/theme-preview w-full rounded-lg outline-none [perspective:900px] [transform-style:preserve-3d]"
              aria-label="Customize theme"
              onPointerMove={handleThemePreviewPointerMove}
              onPointerLeave={resetThemePreviewTransform}
              onPointerCancel={resetThemePreviewTransform}
              onFocus={handleThemePreviewFocus}
              onBlur={resetThemePreviewTransform}
            >
              <Card
                data-theme-preview-card
                className="aspect-[16/9] w-full gap-0 overflow-hidden p-0 shadow-sm [transform:rotateX(5deg)] [transform-origin:center_bottom] [transform-style:preserve-3d] transition-[transform,box-shadow] duration-300 ease-out will-change-transform group-hover/theme-preview:shadow-xl group-focus-visible/theme-preview:shadow-xl motion-reduce:transition-none"
              >
                <div className="flex h-8 items-center gap-1.5 border-b bg-card px-2">
                  <div className="max-w-36 truncate rounded-full bg-accent px-3 py-1 text-xs font-medium">
                    {storefront?.name ?? "Online Store"}
                  </div>
                  <div className="flex-1 truncate rounded-full bg-accent px-3 py-1 text-center text-xs text-muted-foreground">
                    Storefront preview
                  </div>
                </div>
              <EmptyStorefrontPreview />
              </Card>
            </button>
          </TooltipTrigger>
          <TooltipContent side="top" sideOffset={10}>
            Customize theme
          </TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Link
              to="/dashboard/$slug"
              params={{ slug: "products" }}
              className="group/product-stack absolute bottom-6 left-1/2 flex -translate-x-1/2 -space-x-6 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-4 focus-visible:ring-offset-background"
              aria-label="Edit products"
            >
              {Array.from({ length: 3 }, (_, index) => {
                const product = products[index];
                return (
                  <Card
                    key={product?.id ?? index}
                    className={`size-[5.25rem] gap-0 overflow-hidden p-0 transition-transform duration-300 ease-out group-hover/product-stack:scale-[1.04] group-focus-visible/product-stack:scale-[1.04] motion-reduce:transition-none sm:size-[6.75rem] ${DASHBOARD_PRODUCT_CARD_TRANSFORMS[index]}`}
                  >
                    {product?.thumbnailUrl ? (
                      <img
                        src={product.thumbnailUrl}
                        alt={product.title}
                        className="size-full bg-component object-contain"
                      />
                    ) : (
                      <EmptyProductPreview />
                    )}
                  </Card>
                );
              })}
            </Link>
          </TooltipTrigger>
          <TooltipContent side="top" sideOffset={8}>
            Edit products
          </TooltipContent>
        </Tooltip>
      </section>

      <section className="flex w-full max-w-2xl flex-col items-center gap-2 text-center">
        <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">
          Your online store is taking shape
        </h1>
        <p className="text-sm text-muted-foreground">
          Choose where you want to continue working.
        </p>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="outline"
              className="mt-4 h-11 w-full justify-between px-4"
            >
              <span className="flex items-center gap-2 text-muted-foreground">
                <CircleDollarSign />
                What would you like to manage?
              </span>
              <ChevronDown />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="start"
            className="max-h-72 w-[var(--radix-dropdown-menu-trigger-width)]"
          >
            <DropdownMenuLabel>General links</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {GENERAL_LINKS.map((item) => (
              <DropdownMenuItem key={`${item.scope}-${item.slug}`} asChild>
                {item.scope === "settings" ? (
                  <Link
                    to="/dashboard/settings/$slug"
                    params={{ slug: item.slug }}
                    className="justify-between"
                  >
                    {item.label}
                    <ArrowRight />
                  </Link>
                ) : (
                  <Link
                    to="/dashboard/$slug"
                    params={{ slug: item.slug }}
                    className="justify-between"
                  >
                    {item.label}
                    <ArrowRight />
                  </Link>
                )}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </section>

      <section
        aria-label="Quick links"
        className="grid w-full grid-cols-1 gap-3 sm:grid-cols-2"
      >
        {QUICK_LINKS.map((item) => {
          const Icon = item.icon;
          const card = (
            <Card className="h-full gap-3 p-5 transition-colors group-hover:bg-accent/50 group-focus-visible:ring-2 group-focus-visible:ring-ring">
              <div className="flex items-start justify-between gap-4">
                <div className="space-y-2">
                  <CardTitle className="text-sm">{item.title}</CardTitle>
                  <CardDescription>{item.description}</CardDescription>
                </div>
                <Icon className="size-4 shrink-0 text-muted-foreground" />
              </div>
            </Card>
          );
          return item.scope === "settings" ? (
            <Link
              key={`${item.scope}-${item.slug}`}
              to="/dashboard/settings/$slug"
              params={{ slug: item.slug }}
              className="group outline-none"
            >
              {card}
            </Link>
          ) : item.scope === "create" ? (
            <Link
              key={`${item.scope}-${item.slug}`}
              to="/dashboard/$slug/create"
              params={{ slug: item.slug }}
              className="group outline-none"
            >
              {card}
            </Link>
          ) : (
            <Link
              key={`${item.scope}-${item.slug}`}
              to="/dashboard/$slug"
              params={{ slug: item.slug }}
              className="group outline-none"
            >
              {card}
            </Link>
          );
        })}
      </section>
    </div>
  );
}
