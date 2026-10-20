import { AlertCircle, LoaderCircle, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { EditorCodeMonacoState } from "./editor-code-monaco-loader";

/**
 * What the editor pane shows while Monaco is not ready: a loading line, or
 * the error with Retry. It never claims a save or touches a draft; the
 * workspace keeps those and the editor opens with them once Monaco is ready.
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
  return (
    <div
      className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center text-xs text-muted-foreground"
      role="alert"
      data-code-editor-load="error"
      data-code-editor-load-reason={state.reason}
    >
      <div className="flex items-center gap-2 font-medium text-foreground">
        <AlertCircle className="size-4 text-destructive" />
        {state.reason === "timeout"
          ? "The code editor is taking too long to load."
          : "The code editor could not be loaded."}
      </div>
      <p className="max-w-sm">
        Unsaved changes are kept in this tab. Try again; if it keeps failing,
        check the connection. Reloading the page would discard unsaved changes.
      </p>
      <Button variant="outline" size="sm" onClick={onRetry}>
        <RotateCw className="size-3.5" />
        Retry
      </Button>
    </div>
  );
}
