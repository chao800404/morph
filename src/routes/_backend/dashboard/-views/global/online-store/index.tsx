import { Button } from "@/components/ui/button";
import { CardWrapper } from "@/routes/_backend/dashboard/-components/card-wrapper";
import { Link } from "@tanstack/react-router";
import {
  CircleCheck,
  Eye,
  LockKeyhole,
  MoreHorizontal,
  ShoppingBag,
} from "lucide-react";

const PreviewHeader = ({ compact = false }: { compact?: boolean }) => (
  <div className="flex h-10 items-center justify-between border-b border-border/70 bg-background/95 px-3 text-foreground">
    <div className="flex items-center gap-2.5">
      <span className="font-serif text-[11px] font-semibold tracking-tight">
        morph
      </span>
      {!compact ? (
        <div className="flex items-center gap-2 text-[6px] text-muted-foreground">
          <span>Shop</span>
          <span>Journal</span>
          <span>About</span>
        </div>
      ) : null}
    </div>
    <div className="flex items-center gap-1.5 text-muted-foreground">
      <span className="size-2 rounded-full border" />
      <ShoppingBag className="size-2.5" />
    </div>
  </div>
);

const StorefrontPreview = () => (
  <div className="relative mx-auto flex min-h-0 w-full max-w-4xl items-end justify-center px-4 pt-8 sm:px-10 sm:pt-10">
    <div className="w-full overflow-hidden rounded-t-xl border border-border/80 bg-background shadow-[0_18px_50px_-24px_rgba(0,0,0,0.35)]">
      <PreviewHeader />
      <div className="relative flex aspect-[16/7] min-h-44 items-end overflow-hidden bg-muted sm:min-h-52">
        <img
          src="/static/storefront/theme-preview-default.png"
          alt=""
          className="absolute inset-0 size-full object-cover object-center"
        />
        <div className="absolute inset-0 bg-gradient-to-r from-background/85 via-background/35 to-transparent" />
        <div className="relative z-10 max-w-sm space-y-2 p-5 sm:p-8">
          <p className="text-[7px] font-medium uppercase tracking-[0.22em] text-muted-foreground sm:text-[9px]">
            New collection
          </p>
          <p className="font-serif text-xl leading-none tracking-tight text-foreground sm:text-4xl">
            Objects for everyday rituals.
          </p>
          <span className="inline-flex border-b border-foreground/60 pb-0.5 text-[7px] font-medium text-foreground sm:text-[9px]">
            Explore the collection
          </span>
        </div>
      </div>
    </div>

    <div className="absolute bottom-0 right-4 hidden w-[24%] min-w-36 overflow-hidden rounded-t-xl border border-border bg-background shadow-[0_18px_45px_-20px_rgba(0,0,0,0.45)] sm:block lg:right-10">
      <PreviewHeader compact />
      <div className="relative flex aspect-[4/5] items-end overflow-hidden bg-muted">
        <img
          src="/static/storefront/theme-preview-default.png"
          alt=""
          className="absolute inset-0 size-full object-cover object-[68%_center]"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-background/90 via-transparent to-transparent" />
        <div className="relative z-10 space-y-1.5 p-4">
          <p className="font-serif text-lg leading-none text-foreground">
            Made to be kept.
          </p>
          <p className="text-[7px] leading-relaxed text-muted-foreground">
            Quiet essentials, considered in every detail.
          </p>
        </div>
      </div>
    </div>
  </div>
);

export default function OnlineStoreOverview() {
  return (
    <section className="mx-auto flex w-full max-w-6xl flex-col gap-5 py-2 sm:py-4">
      <div className="flex items-end justify-between gap-4 px-1">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-foreground">
            Online Store
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Preview and manage the storefront customers see.
          </p>
        </div>
        <Button
          variant="cardHeader"
          size="xs"
          disabled
          title="No public domain configured"
        >
          <Eye />
          View store
        </Button>
      </div>

      <CardWrapper
        customHeader={
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-base font-medium text-foreground">
                Current theme
              </p>
              <p className="text-sm text-muted-foreground">
                The published presentation for your primary sales channel.
              </p>
            </div>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Theme actions"
              disabled
            >
              <MoreHorizontal />
            </Button>
          </div>
        }
        classNames={{ contentWrapper: "overflow-hidden" }}
      >
        <div className="overflow-hidden border-t bg-muted/35">
          <StorefrontPreview />

          <div className="flex flex-col gap-3 border-t border-border/70 bg-amber-500/8 px-5 py-3 text-amber-950 dark:text-amber-100 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-2 text-sm">
              <LockKeyhole className="size-4 shrink-0 text-amber-600 dark:text-amber-400" />
              <span>
                Storefront access is controlled until a public domain is ready.
              </span>
            </div>
            <Button variant="outline" size="xs" disabled>
              Manage access
            </Button>
          </div>

          <div className="flex flex-col gap-5 bg-component px-5 py-5 sm:flex-row sm:items-end sm:justify-between">
            <div className="space-y-2">
              <div>
                <h2 className="text-base font-semibold text-foreground">
                  Default
                </h2>
                <p className="text-sm text-muted-foreground">
                  Your active storefront theme
                </p>
              </div>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <CircleCheck className="size-3.5 text-primary" />
                <span>Published</span>
                <span aria-hidden="true">·</span>
                <Link
                  to="/dashboard/$slug"
                  params={{ slug: "pages" }}
                  className="font-medium text-foreground underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  Manage pages
                </Link>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="cardHeader"
                size="xs"
                disabled
                title="Theme editor is the next implementation phase"
              >
                Customize theme
              </Button>
            </div>
          </div>
        </div>
      </CardWrapper>
    </section>
  );
}
