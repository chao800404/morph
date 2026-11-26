import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Server } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { ServerResult } from "@/lib/db/server-result";
import type { StorefrontThemeEditorDTO } from "@/lib/storefront/dto/storefront-theme.dto";
import { sendEditorWrite } from "@/lib/storefront/editor/send-editor-write";
import {
  deploymentThemePreviewRuntime,
  isThemePreviewRuntime,
  resolveThemePreviewRuntime,
  themeFrameworkAllowsPreviewRuntime,
  type ThemePreviewRuntime,
} from "@/lib/storefront/theme-preview-runtime";
import { setThemePreviewRuntime } from "@/server/storefront/storefront-theme-preview-server.serverFn";
import { storefrontThemeQueries } from "../-queries/storefront-theme.queries";

export const PREVIEW_RUNTIME_LABELS: Record<ThemePreviewRuntime, string> = {
  client: "Client-only",
  start: "Full Start",
};

/** The radio value for "record nothing, inherit the deployment's". */
const INHERIT = "inherit";

const radioItemClassName =
  "h-6 py-0 pr-1.5 pl-6 text-xs leading-none [&>span:first-child]:left-1.5";

type RuntimeWrite = Readonly<{
  /** What to record; null clears the record. */
  previewRuntime: ThemePreviewRuntime | null;
  /** What the editor showed the Theme recording when the author chose. */
  expectedPreviewRuntime: ThemePreviewRuntime | null;
  /** The runtime the preview was started with when the author chose. */
  effectiveBefore: ThemePreviewRuntime;
}>;

type RuntimeWriteOutcome =
  | Readonly<{
      kind: "saved" | "conflict";
      /** What the Theme records now, as the server read it back. */
      previewRuntime: ThemePreviewRuntime | null;
    }>
  /** Refused by the Theme's files (option B); nothing was switched. */
  | Readonly<{ kind: "refused"; message: string }>;

function joinPaths(paths: readonly string[]): string {
  if (paths.length <= 1) return paths.join("");
  return `${paths.slice(0, -1).join(", ")} and ${paths[paths.length - 1]}`;
}

/**
 * The editor's wording for the two refusals a switch off Start can get from
 * the Theme's files, or null for any other answer. Built from the code and
 * what the answer carries, not from the server's text.
 */
export function previewRuntimeRefusalMessage(result: {
  error?: string;
  paths?: unknown;
}): string | null {
  if (result.error === "PREVIEW_RUNTIME_START_REQUIRED") {
    const paths = Array.isArray(result.paths)
      ? result.paths.filter((path): path is string => typeof path === "string")
      : [];
    return paths.length > 0
      ? `This Theme stays on Full Start: ${joinPaths(paths)} ${paths.length === 1 ? "needs" : "need"} the full Start preview to run. Nothing was switched.`
      : "This Theme stays on Full Start: some of its files need the full Start preview to run. Nothing was switched.";
  }
  if (result.error === "PREVIEW_RUNTIME_SOURCE_CHANGED") {
    return "The Theme's code changed while the runtime was being switched, so nothing was switched. Your code was kept as saved. Check it, then switch the runtime again.";
  }
  return null;
}

/**
 * The Live Preview runtime write, shared by the runtime menu and the empty
 * Theme's next step (`editor-starter-init-next-step.tsx`), so there is one
 * way to switch.
 *
 * Each choice is a compare-and-set on what the editor last saw the Theme
 * record. Once saved, the preview is restarted through the editor's own
 * restart (`onRuntimeChanged`) if the runtime it is served with changed.
 * Refused because someone else changed it meanwhile, the editor shows what
 * the Theme records now and restarts nothing. Refused by the Theme's files,
 * the editor says why in its own words (`previewRuntimeRefusalMessage`) and
 * keeps that as `refusal` until the next saved choice. Never sent again on
 * the author's behalf.
 */
export function usePreviewRuntimeSwitch({
  context,
  onRuntimeChanged,
}: {
  context: StorefrontThemeEditorDTO;
  onRuntimeChanged: () => void;
}) {
  const queryClient = useQueryClient();
  const storefrontId = context.storefront.id;
  const themeId = context.theme.id;
  const recorded = context.theme.previewRuntime;
  const resolved = resolveThemePreviewRuntime({
    recorded,
    deploymentEnvValue: context.previewRuntimeDefault,
  });
  const [refusal, setRefusal] = useState<string | null>(null);

  const showRecorded = (previewRuntime: ThemePreviewRuntime | null) => {
    // The editor context says what the Theme records; patched in place
    // rather than read again, which would hand the editor its templates a
    // second time for a change that is not about them.
    queryClient.setQueryData<ServerResult<StorefrontThemeEditorDTO>>(
      storefrontThemeQueries.detail(storefrontId, themeId).queryKey,
      (current) =>
        current?.success
          ? {
              ...current,
              data: {
                ...current.data,
                theme: { ...current.data.theme, previewRuntime },
              },
            }
          : current,
    );
  };

  const mutation = useMutation({
    mutationFn: async (write: RuntimeWrite): Promise<RuntimeWriteOutcome> => {
      const result = await sendEditorWrite(
        { storefrontId, themeId },
        "theme",
        () =>
          setThemePreviewRuntime({
            data: {
              storefrontId,
              themeId,
              previewRuntime: write.previewRuntime,
              expectedPreviewRuntime: write.expectedPreviewRuntime,
            },
          }),
      );
      if (result.success) {
        return { kind: "saved", previewRuntime: result.data.previewRuntime };
      }
      if (
        result.error === "PREVIEW_RUNTIME_CONFLICT" &&
        "previewRuntime" in result
      ) {
        return {
          kind: "conflict",
          previewRuntime: isThemePreviewRuntime(result.previewRuntime)
            ? result.previewRuntime
            : null,
        };
      }
      const refused = previewRuntimeRefusalMessage(result);
      if (refused !== null) return { kind: "refused", message: refused };
      throw new Error(result.message);
    },
    onSuccess: (outcome, write) => {
      if (outcome.kind === "refused") {
        // The Theme records what it did before; nothing to show or restart.
        setRefusal(outcome.message);
        toast.error(outcome.message);
        return;
      }
      setRefusal(null);
      showRecorded(outcome.previewRuntime);
      if (outcome.kind === "conflict") {
        // Never sent again on the author's behalf: what they chose was a
        // choice against a value that is no longer there.
        toast.info(
          "The Live Preview runtime was changed elsewhere. The menu now shows the current one.",
        );
        return;
      }
      const after = resolveThemePreviewRuntime({
        recorded: outcome.previewRuntime,
        deploymentEnvValue: context.previewRuntimeDefault,
      }).runtime;
      if (after === write.effectiveBefore) {
        toast.success(
          `Live Preview runtime saved. It still uses ${PREVIEW_RUNTIME_LABELS[after]}.`,
        );
        return;
      }
      toast.success(
        `Live Preview now uses the ${PREVIEW_RUNTIME_LABELS[after]} runtime. Restarting the preview.`,
      );
      onRuntimeChanged();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  return {
    recorded,
    resolved,
    refusal,
    isPending: mutation.isPending,
    /**
     * Records `next` (null: inherit the deployment's) against what the
     * editor shows the Theme recording. `onSaved` runs only when it was
     * saved, with what the Theme records now; `onNotSaved` otherwise, with
     * why, for a caller that shows it in place.
     */
    switchTo: (
      next: ThemePreviewRuntime | null,
      options?: {
        onSaved?: (previewRuntime: ThemePreviewRuntime | null) => void;
        onNotSaved?: (message: string) => void;
      },
    ) =>
      mutation.mutate(
        {
          previewRuntime: next,
          expectedPreviewRuntime: recorded,
          effectiveBefore: resolved.runtime,
        },
        {
          onSuccess: (outcome) => {
            if (outcome.kind === "saved") {
              options?.onSaved?.(outcome.previewRuntime);
            } else if (outcome.kind === "refused") {
              options?.onNotSaved?.(outcome.message);
            } else {
              options?.onNotSaved?.(
                "The Live Preview runtime was changed elsewhere, so nothing was switched. The editor now shows the one the Theme records; switch again if you still want Full Start.",
              );
            }
          },
          onError: (error) => options?.onNotSaved?.(error.message),
        },
      ),
  };
}

/**
 * The Live Preview runtime of this Theme (R-0, R1): which one it is
 * previewed with, whether the Theme records it or inherits the deployment's,
 * and a choice of recording either one or inheriting again
 * (`usePreviewRuntimeSwitch`). Not shown for a framework other than TanStack
 * Start, which has only its own preview. Hiding it is not the guard: the
 * server refuses `start` for such a Theme.
 */
export function EditorPreviewRuntimeMenu({
  context,
  onRuntimeChanged,
}: {
  context: StorefrontThemeEditorDTO;
  onRuntimeChanged: () => void;
}) {
  const runtimeSwitch = usePreviewRuntimeSwitch({ context, onRuntimeChanged });
  const { recorded, resolved, refusal, isPending } = runtimeSwitch;
  const deploymentRuntime = deploymentThemePreviewRuntime(
    context.previewRuntimeDefault,
  );

  if (!themeFrameworkAllowsPreviewRuntime(context.theme.framework, "start")) {
    return null;
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="size-7 shrink-0"
          aria-label={`Live Preview runtime: ${PREVIEW_RUNTIME_LABELS[resolved.runtime]}`}
          title="Choose the Live Preview runtime"
          disabled={isPending}
        >
          <Server />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        side="top"
        align="start"
        sideOffset={6}
        className="w-60 p-1 text-xs"
      >
        <DropdownMenuLabel className="px-1.5 py-1 text-[11px] leading-none text-muted-foreground">
          Preview runtime
        </DropdownMenuLabel>
        <p
          className="px-1.5 pb-1 text-[11px] leading-snug text-muted-foreground"
          data-testid="preview-runtime-source"
        >
          {resolved.source === "theme"
            ? `${PREVIEW_RUNTIME_LABELS[resolved.runtime]}, recorded for this Theme.`
            : `${PREVIEW_RUNTIME_LABELS[resolved.runtime]}, the deployment default. Not recorded for this Theme.`}
        </p>
        {refusal ? (
          <p
            className="px-1.5 pb-1 text-[11px] leading-snug text-destructive"
            data-testid="preview-runtime-refusal"
          >
            {refusal}
          </p>
        ) : null}
        <DropdownMenuSeparator className="my-0.5" />
        <DropdownMenuRadioGroup
          value={recorded ?? INHERIT}
          onValueChange={(value) => {
            const next =
              value === INHERIT
                ? null
                : isThemePreviewRuntime(value)
                  ? value
                  : undefined;
            if (next === undefined || next === recorded) return;
            runtimeSwitch.switchTo(next);
          }}
        >
          <DropdownMenuRadioItem
            value={INHERIT}
            className={radioItemClassName}
            disabled={isPending}
          >
            {`Deployment default (${PREVIEW_RUNTIME_LABELS[deploymentRuntime]})`}
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem
            value="client"
            className={radioItemClassName}
            disabled={isPending}
          >
            {PREVIEW_RUNTIME_LABELS.client}
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem
            value="start"
            className={radioItemClassName}
            disabled={isPending}
          >
            {PREVIEW_RUNTIME_LABELS.start}
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
