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
      <AstroDesignNoticeIcon checking={checking} />
      <AlertTitle className="text-xs">{astroDesignNoticeTitle(notice)}</AlertTitle>
      <AlertDescription className="text-xs">
        <p>{notice.message}</p>
      </AlertDescription>
    </Alert>
  );
}

/**
 * The same notice, said where Code mode shows it (review finding 1): an
 * Astro click opens Code, and the Inspector and the sections panel are on
 * the Design surface Code hides. The shell passes the one notice it derives
 * from its focus state, or null when nothing is to be said here.
 *
 * The status region is always mounted, empty while nothing is said, so the
 * text is announced when it arrives rather than with a region inserted
 * already filled (review finding 9).
 */
export function EditorAstroDesignStatusBar({
  notice,
  className,
}: {
  notice: AstroDesignNotice | null;
  className?: string;
}) {
  const checking = notice?.tone === "checking";
  return (
    <div
      role="status"
      aria-live="polite"
      aria-atomic="true"
      data-astro-design-status-bar={notice?.tone ?? "none"}
      className={cn(
        notice &&
          "flex items-start gap-3 border-b px-4 py-2 text-xs [&>svg]:mt-0.5 [&>svg]:size-4 [&>svg]:shrink-0",
        notice && (checking ? "bg-muted/20 text-muted-foreground" : "bg-background"),
        className,
      )}
    >
      {notice ? (
        <>
          <AstroDesignNoticeIcon checking={checking} />
          <div className="min-w-0 flex-1">
            <p className="font-medium text-foreground">
              {astroDesignNoticeTitle(notice)}
            </p>
            <p className="text-muted-foreground">{notice.message}</p>
            {notice.sectionId !== null ? (
              <p className="text-muted-foreground">
                Section: <span className="font-mono">{notice.sectionId}</span>
              </p>
            ) : null}
          </div>
        </>
      ) : null}
    </div>
  );
}

function AstroDesignNoticeIcon({ checking }: { checking: boolean }) {
  return checking ? (
    <LoaderCircle
      aria-hidden="true"
      className="animate-spin motion-reduce:animate-none"
    />
  ) : (
    <CircleAlert aria-hidden="true" />
  );
}

function astroDesignNoticeTitle(notice: AstroDesignNotice): string {
  if (notice.sectionId === null) {
    return "Couldn't restore your selection. Select the section again.";
  }
  return notice.tone === "checking"
    ? "Checking whether this section can be edited in Design…"
    : "This section can't be edited in Design right now.";
}
