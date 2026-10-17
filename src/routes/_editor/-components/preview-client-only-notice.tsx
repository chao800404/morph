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
 * Start (Astro), or whose framework did not resolve, carries neither field,
 * and neither do older responses; all of them mean "nothing to say".
 */
type PreviewStartResult =
  | Readonly<{
      success: true;
      data: Readonly<{
        previewRuntime?: "client" | "start";
        clientOnlyLimits?: readonly ThemeClientOnlyPreviewLimit[];
      }>;
    }>
  | Readonly<{ success: false }>
  | null
  | undefined;

/**
 * What the client-only notice lists for this start, or nothing.
 *
 * Only a successful start that says it served the client-only preview and
 * found uses counts. A full Start preview runs server functions, so it says
 * nothing; a start that does not name its runtime is not guessed at.
 *
 * The list comes from a static reading of the Theme source
 * (theme-client-only-preview-limits.ts). It over-approximates and can miss
 * dynamic forms, so an empty list does not mean the Theme uses no server
 * code; the notice only ever names what was found.
 */
export function previewClientOnlyNoticeLimits(
  result: PreviewStartResult,
): readonly ThemeClientOnlyPreviewLimit[] {
  if (!result || result.success !== true) return [];
  if (result.data.previewRuntime !== "client") return [];
  return result.data.clientOnlyLimits ?? [];
}

const KIND_LABEL: Record<ThemeClientOnlyPreviewLimitKind, string> = {
  createServerFn: "server function",
  createServerOnlyFn: "server-only function",
  "server-api": "server API",
  "server-route": "server route",
};

/**
 * Says that this Live Preview is client-only and which Theme files use what
 * it cannot run, so missing content reads as the preview's limit and not as
 * a Theme bug.
 *
 * Non-blocking: the canvas stays usable, and the author can dismiss it. It is
 * keyed by the shell to the start it describes, so a new start brings it back
 * with that start's files. It never switches the preview for the author.
 */
export function PreviewClientOnlyNotice({
  limits,
  onOpenFile,
}: {
  limits: readonly ThemeClientOnlyPreviewLimit[];
  onOpenFile: (path: string, line?: number) => void;
}) {
  const [dismissed, setDismissed] = useState(false);
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

  if (dismissed || files.length === 0) return null;

  return (
    <Alert
      role="status"
      data-slot="preview-client-only-notice"
      className="absolute bottom-4 left-4 z-40 w-[min(26rem,calc(100%-2rem))] bg-background/95 shadow-lg backdrop-blur-sm"
    >
      <Info />
      <AlertTitle className="pr-6">
        This Live Preview runs in the browser only
      </AlertTitle>
      <AlertDescription className="text-xs">
        <p>
          This Theme uses server functions or server APIs that this preview
          does not run, so content they load may be missing here. The
          published Theme runs them. Found in:
        </p>
        <ul className="w-full space-y-0.5">
          {files.map((file) => (
            <li key={file.path} className="flex min-w-0 items-baseline gap-1.5">
              <button
                type="button"
                className="min-w-0 truncate font-mono text-foreground underline-offset-2 hover:underline focus-visible:underline focus-visible:outline-none"
                title={file.path}
                onClick={() => onOpenFile(file.path, file.line)}
              >
                {file.path}
              </button>
              <span className="shrink-0">({file.kinds.join(", ")})</span>
            </li>
          ))}
        </ul>
        <p>
          The full Start preview runs them. It is currently a deployment
          setting:{" "}
          <span className="font-mono">MORPH_THEME_PREVIEW_RUNTIME=start</span>.
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
