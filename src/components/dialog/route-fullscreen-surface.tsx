import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { cn } from "@/lib/utils";
import { X } from "lucide-react";
import { motion } from "motion/react";
import type { ReactNode } from "react";
import { createSurface } from "./create-surface";

interface RouteFullscreenSurfaceProps {
  children: ReactNode;
  onClose: () => void;
  /**
   * Accessible name for the surface.
   *
   * Required rather than optional: this covers the whole viewport, so a screen
   * reader that is told a dialog opened and not which one has been handed a
   * worse experience than no announcement at all.
   */
  label: string;
  headerLeading?: ReactNode;
  header?: ReactNode;
  headerActions?: ReactNode;
  footer?: ReactNode;
  bodyClassName?: string;
  footerClassName?: string;
  surfaceClassName?: string;
  animated?: boolean;
}

/**
 * Shared full-viewport shell for route-backed dashboard surfaces.
 *
 * The route decides what the body does; this component owns the viewport
 * positioning, surface tokens, close control, Esc hint and dialog semantics so
 * create, edit and preview screens cannot drift visually or in what they
 * announce.
 */
export const RouteFullscreenSurface = ({
  children,
  onClose,
  label,
  headerLeading,
  header,
  headerActions,
  footer,
  bodyClassName,
  footerClassName,
  surfaceClassName,
  animated = false,
}: RouteFullscreenSurfaceProps) => (
  <div className="fixed inset-0 z-50 flex p-2">
    <motion.section
      // Covers the viewport and takes every click, but announced itself as a
      // plain section: assistive tech was given no signal that a modal had
      // opened, and nothing named what it was.
      role="dialog"
      aria-modal="true"
      aria-label={label}
      className={cn(
        createSurface.shell,
        "grid min-h-0 flex-1 grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden rounded-lg dark:shadow-elevation-modal",
        surfaceClassName,
      )}
      initial={animated ? { opacity: 0, y: 20 } : false}
      animate={animated ? { opacity: 1, y: 0 } : undefined}
      transition={animated ? { duration: 0.2 } : undefined}
    >
      <header
        className={cn(
          createSurface.header,
          "grid min-h-12 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center",
        )}
      >
        <div className="flex h-full min-w-0 items-center">
          <div className="flex shrink-0 items-center gap-2 px-4 py-2">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Close"
              onClick={onClose}
            >
              <X className="size-4" />
            </Button>
            <Kbd>esc</Kbd>
          </div>
          {headerLeading ? (
            <div className="flex h-full min-w-0 items-stretch">
              {headerLeading}
            </div>
          ) : null}
        </div>
        <div className="flex min-w-0 items-center justify-center">{header}</div>
        <div className="flex items-center justify-end gap-2 px-4 py-2">
          {headerActions}
        </div>
      </header>

      <main className={cn(createSurface.body, bodyClassName)}>{children}</main>

      {footer ? (
        <footer className={cn(createSurface.footer, footerClassName)}>
          {footer}
        </footer>
      ) : null}
    </motion.section>
  </div>
);
