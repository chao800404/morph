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

const radioItemClassName =
  "h-6 py-0 pr-1.5 pl-6 text-xs leading-none [&>span:first-child]:left-1.5";

/**
 * The Live Preview runtime of this Theme (R-0, R1): which one it is
 * previewed with, whether the Theme records it or inherits the deployment's,
 * and a choice between the two. Choosing records it, then restarts the
 * preview through the editor's own restart (`onRuntimeChanged`), so the next
 * start is served with it. Not shown for a framework other than TanStack
 * Start, which has only its own preview.
 *
 * Hiding it is not the guard: the server refuses `start` for such a Theme.
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
  const resolved = resolveThemePreviewRuntime({
    recorded: context.theme.previewRuntime,
    deploymentEnvValue: context.previewRuntimeDefault,
  });

  const mutation = useMutation({
    mutationFn: async (previewRuntime: ThemePreviewRuntime) => {
      const result = await sendEditorWrite(
        { storefrontId, themeId },
        "theme",
        () =>
          setThemePreviewRuntime({
            data: { storefrontId, themeId, previewRuntime },
          }),
      );
      if (!result.success) throw new Error(result.message);
      return result.data.previewRuntime;
    },
    onSuccess: (previewRuntime) => {
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
      toast.success(
        `Live Preview now uses the ${RUNTIME_LABELS[previewRuntime]} runtime. Restarting the preview.`,
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
        className="w-56 p-1 text-xs"
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
          value={resolved.runtime}
          onValueChange={(value) => {
            if (!isThemePreviewRuntime(value)) return;
            if (value === resolved.runtime) return;
            mutation.mutate(value);
          }}
        >
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
