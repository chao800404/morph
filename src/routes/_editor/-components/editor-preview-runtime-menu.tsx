import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Server } from "lucide-react";
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

const RUNTIME_LABELS: Record<ThemePreviewRuntime, string> = {
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

type RuntimeWriteOutcome = Readonly<{
  kind: "saved" | "conflict";
  /** What the Theme records now, as the server read it back. */
  previewRuntime: ThemePreviewRuntime | null;
}>;

/**
 * The Live Preview runtime of this Theme (R-0, R1): which one it is
 * previewed with, whether the Theme records it or inherits the deployment's,
 * and a choice of recording either one or inheriting again.
 *
 * Each choice is a compare-and-set on what the editor last saw the Theme
 * record. Once saved, the preview is restarted through the editor's own
 * restart (`onRuntimeChanged`) if the runtime it is served with changed.
 * Refused because someone else changed it meanwhile, the editor shows what
 * the Theme records now and restarts nothing; the author may choose again.
 * Not shown for a framework other than TanStack Start, which has only its
 * own preview. Hiding it is not the guard: the server refuses `start` for
 * such a Theme.
 */
export function EditorPreviewRuntimeMenu({
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
  const deploymentRuntime = deploymentThemePreviewRuntime(
    context.previewRuntimeDefault,
  );
  const resolved = resolveThemePreviewRuntime({
    recorded,
    deploymentEnvValue: context.previewRuntimeDefault,
  });

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
      throw new Error(result.message);
    },
    onSuccess: (outcome, write) => {
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
          `Live Preview runtime saved. It still uses ${RUNTIME_LABELS[after]}.`,
        );
        return;
      }
      toast.success(
        `Live Preview now uses the ${RUNTIME_LABELS[after]} runtime. Restarting the preview.`,
      );
      onRuntimeChanged();
    },
    onError: (error: Error) => toast.error(error.message),
  });

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
          aria-label={`Live Preview runtime: ${RUNTIME_LABELS[resolved.runtime]}`}
          title="Choose the Live Preview runtime"
          disabled={mutation.isPending}
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
            ? `${RUNTIME_LABELS[resolved.runtime]}, recorded for this Theme.`
            : `${RUNTIME_LABELS[resolved.runtime]}, the deployment default. Not recorded for this Theme.`}
        </p>
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
            mutation.mutate({
              previewRuntime: next,
              expectedPreviewRuntime: recorded,
              effectiveBefore: resolved.runtime,
            });
          }}
        >
          <DropdownMenuRadioItem
            value={INHERIT}
            className={radioItemClassName}
            disabled={mutation.isPending}
          >
            {`Deployment default (${RUNTIME_LABELS[deploymentRuntime]})`}
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem
            value="client"
            className={radioItemClassName}
            disabled={mutation.isPending}
          >
            {RUNTIME_LABELS.client}
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem
            value="start"
            className={radioItemClassName}
            disabled={mutation.isPending}
          >
            {RUNTIME_LABELS.start}
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
