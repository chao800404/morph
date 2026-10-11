import { CircleAlert, Code2 } from "lucide-react";
import { useMemo } from "react";
import { Button } from "@/components/ui/button";
import {
  describePreviewCompileFailureCause,
  readPreviewCompileFailureCauses,
  type PreviewCompileFailure,
} from "@/lib/storefront/editor/preview-compile-failure";

type ThemeFile = Readonly<{ path: string; content: string }>;

/**
 * Why the canvas is empty when the preview could not load the Theme's page.
 *
 * Every reason here is the editor's own reading of the preview's copy of the
 * source, captured when the failure was reported; the frame only said which
 * files the server refused (preview-compile-failure.ts). The author's draft
 * is consulted for one thing: whether it has moved past that copy, which is
 * said as such rather than diagnosed. With no reason confirmed, the alert
 * says so and leaves the server's own message to the canvas.
 *
 * Kept to the bottom of the canvas: the top of the frame is where the page
 * shows the server's message.
 */
export function PreviewCompileErrorAlert({
  failure,
  files,
  onOpenFile,
}: {
  failure: PreviewCompileFailure;
  /** The editor's current drafts. */
  files: readonly ThemeFile[];
  onOpenFile: (path: string, line?: number, column?: number) => void;
}) {
  const readings = useMemo(() => {
    const drafts = new Map(files.map((file) => [file.path, file.content]));
    return readPreviewCompileFailureCauses(
      failure,
      (path) => drafts.get(path) ?? null,
    );
  }, [failure, files]);
  const first = readings[0];
  if (!first) return null;
  const confirmed = readings.some((reading) => reading.causes.length > 0);
  const firstSyntax = first.causes.find((cause) => cause.kind === "syntax");

  return (
    <div
      role="alert"
      data-slot="preview-compile-error"
      data-cause={confirmed ? "confirmed" : "unconfirmed"}
      className="absolute bottom-20 left-1/2 z-50 flex w-[min(32rem,calc(100%-2rem))] -translate-x-1/2 items-start gap-3 rounded-lg border border-destructive/40 bg-background/95 p-3 text-sm shadow-lg backdrop-blur-sm"
    >
      <CircleAlert className="mt-0.5 size-4 shrink-0 text-destructive" />
      <div className="min-w-0 space-y-2">
        <p className="font-medium text-foreground">
          {confirmed
            ? "This page does not compile, so Live Preview cannot show it."
            : "Live Preview could not load this page."}
        </p>
        <ul className="space-y-1 text-xs text-muted-foreground">
          {readings.map(({ path, causes, draftAhead }) => (
            <li key={path} className="space-y-1 break-words">
              {causes.length > 0 ? (
                causes.map((cause) => (
                  <p
                    key={
                      cause.kind === "syntax" ? "syntax" : cause.specifier
                    }
                  >
                    {describePreviewCompileFailureCause(path, cause)}
                  </p>
                ))
              ) : (
                <p>
                  The preview server answered{" "}
                  <span className="font-mono">{path}</span> with an error. The
                  cause is not confirmed here; the canvas shows the server's
                  message if it sent one.
                </p>
              )}
              {draftAhead ? (
                <p>
                  Your latest edits to{" "}
                  <span className="font-mono">{path}</span> are not in the
                  preview yet; this is about the version it has.
                </p>
              ) : null}
            </li>
          ))}
        </ul>
        <p className="text-xs text-muted-foreground">
          Your content is kept. The canvas reloads once a change is saved into
          the preview.
        </p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="gap-1.5"
          onClick={() =>
            onOpenFile(first.path, firstSyntax?.line, firstSyntax?.column)
          }
        >
          <Code2 className="size-3.5" />
          Open {first.path.split("/").pop()} in Code
        </Button>
      </div>
    </div>
  );
}
