import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import type { AstroDesignNotice } from "@/lib/storefront/editor/astro-design-focus";
import { cn } from "@/lib/utils";
import { CircleAlert, LoaderCircle } from "lucide-react";

/**
 * The Astro Design status of the selected section, at the top of the
 * Inspector (lead decision Q2). It replaces the "reload the preview" toast:
 * the hint stays beside the section it is about until it no longer holds.
 * A polite status, not an alert: nothing failed, the author is told what to
 * do next.
 */
export function EditorAstroDesignNotice({
  notice,
  className,
}: {
  notice: AstroDesignNotice;
  className?: string;
}) {
  const checking = notice.tone === "checking";
  return (
    <Alert
      role="status"
      aria-live="polite"
      variant={checking ? "muted" : "default"}
      data-astro-design-notice={notice.tone}
      className={cn("px-3 py-2 text-xs", className)}
    >
      {checking ? (
        <LoaderCircle
          aria-hidden="true"
          className="animate-spin motion-reduce:animate-none"
        />
      ) : (
        <CircleAlert aria-hidden="true" />
      )}
      <AlertTitle className="text-xs">
        {notice.sectionId === null
          ? "Selection cleared"
          : checking
            ? `Checking section ${notice.sectionId}`
            : `Design unavailable for section ${notice.sectionId}`}
      </AlertTitle>
      <AlertDescription className="text-xs">
        <p>{notice.message}</p>
      </AlertDescription>
    </Alert>
  );
}
