import { Info, X } from "lucide-react";
import { useMemo, useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import type {
  ThemeClientOnlyPreviewLimit,
  ThemeClientOnlyPreviewLimitKind,
} from "@/lib/storefront/compiler/theme-client-only-preview-limits";

/**
 * The start response fields this notice reads, as the preview server query
 * holds them. Loose on purpose: a start for a Theme that is not TanStack
 * Start (Astro), or whose framework did not resolve, carries none of them,
 * and neither do older responses; all of them mean "nothing to say".
 */
type PreviewStartResult =
  | Readonly<{
      success: true;
      data: Readonly<{
        previewRuntime?: "client" | "start";
        clientOnlyLimits?: readonly ThemeClientOnlyPreviewLimit[];
        clientOnlyLimitsOmitted?: number;
        clientOnlyLimitsIncomplete?: boolean;
      }>;
    }>
  | Readonly<{ success: false }>
  | null
  | undefined;

/** What the client-only notice says for one start. */
export type PreviewClientOnlyNoticeContent = Readonly<{
  limits: readonly ThemeClientOnlyPreviewLimit[];
  /** Found but not listed (the start lists at most 100). */
  omitted: number;
  /** Some source could not be checked, so the list may be partial. */
  incomplete: boolean;
}>;

/**
 * What the client-only notice says for this start, or `null` for nothing.
 *
 * Only a successful start that says it served the client-only preview
 * counts, and only when it found uses or could not check everything. A full
 * Start preview runs server functions, so it says nothing; a start that does
 * not name its runtime is not guessed at.
 *
 * The list comes from a static reading of the Theme source when the preview
 * started (theme-client-only-preview-limits.ts). It over-approximates and
 * can miss dynamic forms, so an empty list does not mean the Theme uses no
 * server code; the notice only ever names what was found. It is not
 * recomputed as files are edited: the notice says so.
 */
export function previewClientOnlyNoticeContent(
  result: PreviewStartResult,
): PreviewClientOnlyNoticeContent | null {
  if (!result || result.success !== true) return null;
  if (result.data.previewRuntime !== "client") return null;
  const limits = result.data.clientOnlyLimits ?? [];
  const incomplete = result.data.clientOnlyLimitsIncomplete === true;
  if (limits.length === 0 && !incomplete) return null;
  return {
    limits,
    omitted: Math.max(0, result.data.clientOnlyLimitsOmitted ?? 0),
    incomplete,
  };
}

const KIND_LABEL: Record<ThemeClientOnlyPreviewLimitKind, string> = {
  createServerFn: "server function",
  createServerOnlyFn: "server-only function",
  "server-api": "server API",
  "server-route": "server route",
};

/**
 * Says that this Live Preview runs client-only and which Theme files use
 * what it cannot run, so missing content reads as the preview's limit and
 * not as a Theme bug.
 *
 * The `role="status"` region is always mounted and the notice is rendered
 * into it, so a screen reader announces the notice when it appears (a live
 * region that arrives together with its content is often not announced).
 *
 * Non-blocking: the canvas stays usable, and the author can dismiss it. The
 * notice is keyed to the start it describes (`startKey`), so a new start
 * brings it back with that start's files. It never switches the preview for
 * the author.
 */
export function PreviewClientOnlyNotice({
  content,
  startKey,
  onOpenFile,
}: {
  content: PreviewClientOnlyNoticeContent | null;
  startKey: string | number;
  onOpenFile: (path: string, line?: number) => void;
}) {
  return (
    <div
      role="status"
      aria-live="polite"
      data-slot="preview-client-only-notice-region"
      className="pointer-events-none absolute bottom-4 left-4 z-40 w-[min(26rem,calc(100%-2rem))]"
    >
      {content ? (
        <PreviewClientOnlyNoticeCard
          key={startKey}
          content={content}
          onOpenFile={onOpenFile}
        />
      ) : null}
    </div>
  );
}

function PreviewClientOnlyNoticeCard({
  content,
  onOpenFile,
}: {
  content: PreviewClientOnlyNoticeContent;
  onOpenFile: (path: string, line?: number) => void;
}) {
  const [dismissed, setDismissed] = useState(false);
  const { limits, omitted, incomplete } = content;
  const files = useMemo(() => {
    const byFile = new Map<
      string,
      { line: number; kinds: Set<ThemeClientOnlyPreviewLimitKind> }
    >();
    for (const limit of limits) {
      const entry = byFile.get(limit.file);
      if (entry) {
        entry.kinds.add(limit.kind);
        entry.line = Math.min(entry.line, limit.line);
      } else {
        byFile.set(limit.file, { line: limit.line, kinds: new Set([limit.kind]) });
      }
    }
    return [...byFile.entries()].map(([path, { line, kinds }]) => ({
      path,
      line,
      kinds: [...kinds].map((kind) => KIND_LABEL[kind]),
    }));
  }, [limits]);

  if (dismissed) return null;

  return (
    <Alert
      // The region around it is the live region; the card is not a second one.
      role="group"
      aria-label="Client-only preview notice"
      data-slot="preview-client-only-notice"
      className="pointer-events-auto bg-background/95 shadow-lg backdrop-blur-sm"
    >
      <Info />
      <AlertTitle className="pr-6">Client-only preview</AlertTitle>
      <AlertDescription className="text-xs">
        {files.length > 0 ? (
          <>
            <p>
              This preview runs in client-only mode, so the server functions
              and server APIs below do not run here, and content they load may
              be missing. The published Theme runs them.
            </p>
            <ul className="w-full space-y-0.5">
              {files.map((file) => (
                <li
                  key={file.path}
                  className="flex min-w-0 items-baseline gap-1.5"
                >
                  <Button
                    type="button"
                    variant="link"
                    className="h-auto min-w-0 justify-start truncate p-0 font-mono text-xs text-foreground"
                    title={file.path}
                    onClick={() => onOpenFile(file.path, file.line)}
                  >
                    {file.path}
                  </Button>
                  <span className="shrink-0">({file.kinds.join(", ")})</span>
                </li>
              ))}
            </ul>
            {omitted > 0 ? <p>and {omitted} more not listed.</p> : null}
            {incomplete ? (
              <p>Some files could not be checked, so this list may be incomplete.</p>
            ) : null}
          </>
        ) : (
          <p>
            This preview runs in client-only mode, so server functions and
            server APIs do not run here. Some Theme files could not be checked
            for them, so ones that do not run here may not be listed.
          </p>
        )}
        <p>
          A full Start preview is a deployment-level setting that is not
          enabled for this preview.
        </p>
        <p>
          {files.length > 0 ? "The list" : "This check"} reflects the Theme as
          of when this preview started.
        </p>
      </AlertDescription>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="absolute right-1.5 top-1.5 size-6"
        aria-label="Dismiss the client-only preview notice"
        onClick={() => setDismissed(true)}
      >
        <X className="size-3.5" />
      </Button>
    </Alert>
  );
}
