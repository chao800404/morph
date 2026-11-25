import { LoaderCircle, Server } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import type { StorefrontThemeEditorDTO } from "@/lib/storefront/dto/storefront-theme.dto";
import { themeFrameworkAllowsPreviewRuntime } from "@/lib/storefront/theme-preview-runtime";
import { cn } from "@/lib/utils";
import { usePreviewRuntimeSwitch } from "./editor-preview-runtime-menu";

/**
 * The editor's Starter init refused, with the server's code kept so the
 * editor can tell a refusal it has a next step for from any other failure.
 */
export class StarterInitError extends Error {
  readonly code: string | undefined;
  constructor(message: string, code?: string) {
    super(message);
    this.name = "StarterInitError";
    this.code = code;
  }
}

/**
 * Whether the init was refused because the Theme does not record `start`
 * while the Starter's files need the full Start preview (option B). Nothing
 * was written and the runtime was not switched.
 */
export function isStarterInitStartRequired(error: unknown): boolean {
  return (
    error instanceof StarterInitError &&
    error.code === "STARTER_START_PREVIEW_REQUIRED"
  );
}

/**
 * The next step for an empty Theme whose Starter init was refused for its
 * preview runtime: the editor stays open, says what to do, and offers the
 * switch to Full Start through the runtime write the runtime menu uses
 * (`usePreviewRuntimeSwitch`, a compare-and-set on what the Theme records).
 * Only once the Theme records `start` is the init asked for again
 * (`onInitialise`); the server holds the init to `start` either way.
 * Nothing for any other error, or for a Theme that cannot use Start.
 */
export function EditorStarterInitNextStep({
  context,
  error,
  onInitialise,
  onRuntimeChanged,
  className,
}: {
  context: StorefrontThemeEditorDTO;
  /** The Starter init's error, or null. */
  error: unknown;
  onInitialise: () => void;
  onRuntimeChanged: () => void;
  className?: string;
}) {
  const runtimeSwitch = usePreviewRuntimeSwitch({ context, onRuntimeChanged });

  if (
    !isStarterInitStartRequired(error) ||
    !themeFrameworkAllowsPreviewRuntime(context.theme.framework, "start")
  ) {
    return null;
  }

  return (
    <div
      role="status"
      className={cn("border-b px-4 py-2", className)}
      data-editor-starter-init="start-required"
    >
      <Alert
        // The region around it is the live region; the card is not a second one.
        role="group"
        aria-label="Next step for this empty Theme"
        className="text-xs"
      >
        <Server />
        <AlertTitle>This Theme has no files yet.</AlertTitle>
        <AlertDescription className="text-xs">
          <p>
            The Starter reads its content on the server, which only the full
            Start preview can show, so nothing was added. Switch this Theme to
            Full Start, then initialise it again.
          </p>
          {runtimeSwitch.refusal ? <p>{runtimeSwitch.refusal}</p> : null}
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="mt-1"
            disabled={runtimeSwitch.isPending}
            onClick={() =>
              runtimeSwitch.switchTo("start", {
                onSaved: (previewRuntime) => {
                  if (previewRuntime === "start") onInitialise();
                },
              })
            }
          >
            {runtimeSwitch.isPending ? (
              <LoaderCircle className="size-3.5 animate-spin" />
            ) : null}
            Switch to Full Start and initialise
          </Button>
        </AlertDescription>
      </Alert>
    </div>
  );
}
