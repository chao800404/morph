import { AlertCircle, LoaderCircle, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { EditorCodeMonacoState } from "./editor-code-monaco-loader";

/**
 * What the editor pane shows while Monaco is not ready: a loading line, or
 * the error. It never claims a save or touches a draft; the workspace keeps
 * those and the editor opens with them once Monaco is ready.
 *
 * Retry only for a timeout, where the request is still open and can still
 * answer. A failed import cannot be retried in this page (see
 * `editor-code-monaco-loader.ts`), so that state says a reload is needed and
 * offers nothing that would look like it helps.
 */
export function EditorCodeMonacoStatus({
  state,
  onRetry,
}: {
  state: Exclude<EditorCodeMonacoState, { status: "ready" }>;
  onRetry: () => void;
}) {
  if (state.status === "loading") {
    return (
      <div
        className="flex h-full items-center justify-center gap-2 text-xs text-muted-foreground"
        role="status"
        data-code-editor-load="loading"
      >
        <LoaderCircle className="size-3.5 animate-spin" />
        Loading the code editor…
      </div>
    );
  }
  const timedOut = state.reason === "timeout";
  return (
    <div
      className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center text-xs text-muted-foreground"
      role="alert"
      data-code-editor-load="error"
      data-code-editor-load-reason={state.reason}
    >
      <div className="flex items-center gap-2 font-medium text-foreground">
        <AlertCircle className="size-4 text-destructive" />
        {timedOut
          ? "The code editor is taking too long to load."
          : "The code editor could not be loaded."}
      </div>
      {timedOut ? (
        <>
          <p className="max-w-sm">
            Unsaved changes are kept in this tab. The download is still
            waiting for an answer; try again, or check the connection.
          </p>
          <Button variant="outline" size="sm" onClick={onRetry}>
            <RotateCw className="size-3.5" />
            Retry
          </Button>
        </>
      ) : (
        <p className="max-w-sm">
          This page cannot load it again: reload the page to open the code
          editor. Unsaved changes are still in this tab, and reloading
          discards them.
        </p>
      )}
    </div>
  );
}
