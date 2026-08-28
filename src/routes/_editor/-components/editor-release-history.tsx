import {
  useInfiniteQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import { CheckCircle2, History, LoaderCircle, RotateCcw } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  describeReleaseHistory,
  expectedActiveReleaseId,
} from "@/lib/storefront/editor/release-history-view";
import { activateStorefrontRelease } from "@/server/storefront/storefront-releases.serverFn";
import { storefrontReleaseQueries } from "../-queries/storefront-release.queries";
import { storefrontThemeQueries } from "../-queries/storefront-theme.queries";

export function EditorReleaseHistoryDialog({
  open,
  onOpenChange,
  storefrontId,
  themeId,
  activeReleaseId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  storefrontId: string;
  themeId: string;
  activeReleaseId: string | null;
}) {
  const queryClient = useQueryClient();
  const history = useInfiniteQuery({
    ...storefrontReleaseQueries.history(storefrontId),
    // Only fetched while the dialog is open: it is a rarely-opened panel, and
    // the list is worthless if it is not current at the moment it is read.
    enabled: open,
    staleTime: 0,
  });
  const releases = history.data?.pages.flat() ?? [];
  const rows = describeReleaseHistory(releases, activeReleaseId);

  const activate = useMutation({
    mutationFn: async (releaseId: string) => {
      const result = await activateStorefrontRelease({
        data: {
          storefrontId,
          releaseId,
          expectedActiveReleaseId: expectedActiveReleaseId(
            rows,
            activeReleaseId,
          ),
        },
      });
      if (!result.success) throw new Error(result.message);
      return result.data;
    },
    onSuccess: async () => {
      toast.success("Release activated. Production now serves this version.");
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: storefrontReleaseQueries.all(),
        }),
        queryClient.invalidateQueries({
          queryKey: storefrontThemeQueries.detail(storefrontId, themeId)
            .queryKey,
        }),
      ]);
    },
    onError: (error: Error) => {
      toast.error(error.message);
      // A rejected activation usually means someone else moved the pointer, so
      // the list this view was built from is the part that is out of date.
      void queryClient.invalidateQueries({
        queryKey: storefrontReleaseQueries.all(),
      });
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <History className="size-4" />
            Release history
          </DialogTitle>
          <DialogDescription>
            Every published version of this storefront. Activating one switches
            production to its immutable build.
          </DialogDescription>
        </DialogHeader>

        {history.isPending ? (
          <div
            className="flex items-center justify-center py-10"
            role="status"
            aria-label="Loading release history"
          >
            <LoaderCircle className="size-5 animate-spin text-muted-foreground" />
          </div>
        ) : history.isError ? (
          <div className="space-y-3 py-6 text-sm">
            <p className="text-destructive">
              {history.error instanceof Error
                ? history.error.message
                : "Failed to load release history."}
            </p>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => void history.refetch()}
            >
              Try again
            </Button>
          </div>
        ) : rows.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            No releases yet. Publishing this theme creates the first one.
          </p>
        ) : (
          <ul className="max-h-[26rem] space-y-1.5 overflow-y-auto">
            {rows.map((row) => (
              <li
                key={row.id}
                data-release-active={row.isActive ? "true" : undefined}
                className="flex items-center gap-3 rounded-md border px-3 py-2.5 data-[release-active=true]:border-primary/40 data-[release-active=true]:bg-primary/5"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <code className="text-sm font-medium">{row.label}</code>
                    {row.isActive ? (
                      <Badge variant="default" className="gap-1">
                        <CheckCircle2 className="size-3" />
                        Live
                      </Badge>
                    ) : null}
                    {row.isInvalidated ? (
                      <Badge variant="outline">Invalidated</Badge>
                    ) : null}
                    {row.hasPublishedContent ? (
                      <Badge variant="secondary">Content</Badge>
                    ) : null}
                  </div>
                  {/* Muted foreground at this size lands at 4.35:1 on the
                      row's own background — under AA. */}
                  <p className="mt-0.5 text-xs text-foreground/75">
                    {new Date(row.createdAt).toLocaleString()}
                  </p>
                </div>

                {row.canActivate ? (
                  <Button
                    type="button"
                    size="xs"
                    variant="outline"
                    className="gap-1.5"
                    disabled={activate.isPending}
                    onClick={() => activate.mutate(row.id)}
                  >
                    {activate.isPending && activate.variables === row.id ? (
                      <LoaderCircle className="size-3.5 animate-spin" />
                    ) : (
                      <RotateCcw className="size-3.5" />
                    )}
                    Activate
                  </Button>
                ) : (
                  <span className="max-w-[12rem] text-right text-xs text-foreground/75">
                    {row.blockedReason}
                  </span>
                )}
              </li>
            ))}
            {history.hasNextPage ? (
              <li className="pt-1">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="w-full"
                  disabled={history.isFetchingNextPage}
                  onClick={() => void history.fetchNextPage()}
                >
                  {history.isFetchingNextPage ? (
                    <LoaderCircle className="size-3.5 animate-spin" />
                  ) : null}
                  Load older releases
                </Button>
              </li>
            ) : null}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}
