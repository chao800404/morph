import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle,
  CheckCircle2,
  CircleDot,
  LoaderCircle,
  Package,
  RefreshCw,
} from "lucide-react";
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
import type { ThemeDependencyCatalogItem } from "@/lib/storefront/compiler/theme-dependency-policy";
import type { StorefrontThemeDependencyDTO } from "@/lib/storefront/dto/storefront-theme-dependency.dto";
import {
  listThemeDependencies,
  requestThemeDependency,
} from "@/server/storefront/storefront-theme-builds.serverFn";

const dependenciesQueryKey = (storefrontId: string, themeId: string) =>
  ["editor-theme-dependencies", storefrontId, themeId] as const;

type DependenciesResponse = {
  catalog: ThemeDependencyCatalogItem[];
  dependencies: StorefrontThemeDependencyDTO[];
};

function statusLabel(
  status: StorefrontThemeDependencyDTO["status"] | undefined,
) {
  switch (status) {
    case "requested":
      return "Queued";
    case "building":
      return "Building";
    case "ready":
      return "Ready";
    case "failed":
      return "Failed";
    case "rejected":
      return "Unavailable";
    default:
      return "Available";
  }
}

function StatusIcon({
  status,
}: {
  status: StorefrontThemeDependencyDTO["status"] | undefined;
}) {
  if (status === "ready")
    return <CheckCircle2 className="size-3.5 text-emerald-500" />;
  if (status === "building" || status === "requested") {
    return <LoaderCircle className="size-3.5 animate-spin text-primary" />;
  }
  if (status === "failed" || status === "rejected") {
    return <AlertCircle className="size-3.5 text-destructive" />;
  }
  return <CircleDot className="size-3.5 text-muted-foreground" />;
}

export function EditorThemeDependenciesDialog({
  open,
  onOpenChange,
  storefrontId,
  themeId,
  sourceRevisionId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  storefrontId: string;
  themeId: string;
  /** The latest successful build's source revision. Omit when it is stale. */
  sourceRevisionId?: string;
}) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: dependenciesQueryKey(storefrontId, themeId),
    enabled: open,
    queryFn: async (): Promise<DependenciesResponse> => {
      const result = await listThemeDependencies({
        data: { storefrontId, themeId },
      });
      if (!result.success) throw new Error(result.message);
      return result.data;
    },
    // A queued build is completed by a Worker/Queue outside this request.
    // Poll only while the panel is visible; the final state is persisted in D1.
    refetchInterval: open ? 2_000 : false,
    staleTime: 0,
  });

  const request = useMutation({
    mutationFn: async (packageName: string) => {
      if (!sourceRevisionId) {
        throw new Error(
          "Build Preview must be up to date before enabling a package.",
        );
      }
      const result = await requestThemeDependency({
        data: {
          storefrontId,
          themeId,
          sourceRevisionId,
          packageName,
        },
      });
      if (!result.success) throw new Error(result.message);
      return result.data;
    },
    onSuccess: async () => {
      toast.success(
        "Package build queued. It will be available when the build is ready.",
      );
      await queryClient.invalidateQueries({
        queryKey: dependenciesQueryKey(storefrontId, themeId),
      });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const rows = query.data?.catalog ?? [];
  const states = new Map(
    (query.data?.dependencies ?? []).map((dependency) => [
      dependency.packageName,
      dependency,
    ]),
  );
  const canRequest = Boolean(sourceRevisionId) && !request.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Package className="size-4 text-primary" />
            Theme packages
          </DialogTitle>
          <DialogDescription>
            Choose a platform-approved package. Morph builds it in the isolated
            Theme toolchain before it becomes available to Code Mode.
          </DialogDescription>
        </DialogHeader>

        {!sourceRevisionId ? (
          <div className="mt-3 flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
            <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
            <span>
              Save your files and run Build Preview before requesting a package.
            </span>
          </div>
        ) : null}

        {query.isPending ? (
          <div
            className="flex items-center justify-center py-10"
            role="status"
            aria-label="Loading theme packages"
          >
            <LoaderCircle className="size-5 animate-spin text-muted-foreground" />
          </div>
        ) : query.isError ? (
          <div className="space-y-3 py-6 text-sm">
            <p className="text-destructive">
              {query.error instanceof Error
                ? query.error.message
                : "Failed to load theme packages."}
            </p>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => void query.refetch()}
            >
              <RefreshCw className="size-3.5" />
              Try again
            </Button>
          </div>
        ) : rows.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            No packages have been approved for this Theme toolchain yet.
          </p>
        ) : (
          <ul className="mt-3 max-h-[26rem] space-y-1.5 overflow-y-auto">
            {rows.map((item) => {
              const state = states.get(item.root);
              const status = state?.status;
              const isReady = status === "ready";
              const isBusy = status === "requested" || status === "building";
              const actionLabel = isReady
                ? "Enabled"
                : isBusy
                  ? statusLabel(status)
                  : status === "failed"
                    ? "Retry"
                    : "Enable";
              return (
                <li
                  key={item.root}
                  className="flex items-center gap-3 rounded-md border px-3 py-2.5"
                  data-package-status={status ?? "available"}
                >
                  <StatusIcon status={status} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <code className="truncate text-sm font-medium">
                        {item.name}
                      </code>
                      {status ? (
                        <Badge variant={isReady ? "default" : "outline"}>
                          {statusLabel(status)}
                        </Badge>
                      ) : null}
                    </div>
                    <p className="mt-0.5 text-xs text-foreground/70">
                      v{item.version}
                    </p>
                    {state?.errorMessage ? (
                      <p className="mt-1 text-xs text-destructive">
                        {state.errorMessage}
                      </p>
                    ) : null}
                  </div>
                  <Button
                    type="button"
                    size="xs"
                    variant={isReady ? "ghost" : "outline"}
                    disabled={!canRequest || isReady || isBusy}
                    onClick={() => request.mutate(item.root)}
                  >
                    {request.isPending && request.variables === item.root ? (
                      <LoaderCircle className="size-3.5 animate-spin" />
                    ) : null}
                    {actionLabel}
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}
