import { checkStorefrontPublishMedia } from "@/server/storefront/storefront-publish-check.serverFn";
import { queryOptions } from "@tanstack/react-query";
import { AlertTriangle, LoaderCircle } from "lucide-react";

export const publishMediaCheckQuery = (ids: {
  storefrontId: string;
  themeId: string;
  templateId: string;
}) =>
  queryOptions({
    queryKey: ["storefront-publish-media-check", ids],
    queryFn: () => checkStorefrontPublishMedia({ data: ids }),
    // Asked each time the confirmation opens: the answer is about the drafts
    // as they are now, and an earlier one may describe content since fixed.
    staleTime: 0,
    gcTime: 0,
    retry: false,
  });

export type PublishMediaCheckState =
  | { status: "checking" }
  | { status: "failed" }
  | { status: "done"; brokenImages: readonly string[] };

export function publishMediaCheckState(query: {
  isPending: boolean;
  isError: boolean;
  data?: { success: boolean; data?: { brokenImages: string[] } | null };
}): PublishMediaCheckState {
  if (query.isPending) return { status: "checking" };
  if (query.isError || !query.data?.success || !query.data.data) {
    return { status: "failed" };
  }
  return { status: "done", brokenImages: query.data.data.brokenImages };
}

/** Whether the confirmation should wait, and what its button should say. */
export function publishConfirmation(state: PublishMediaCheckState): {
  disabled: boolean;
  label: string;
} {
  if (state.status === "checking") return { disabled: true, label: "Publish" };
  if (state.status === "done" && state.brokenImages.length > 0) {
    return { disabled: false, label: "Publish anyway" };
  }
  return { disabled: false, label: "Publish" };
}

const MAX_LISTED = 6;

/**
 * Images the release would show visitors as broken, listed before it goes
 * live. Advisory: the author can still publish, having seen where they are.
 */
export function EditorPublishMediaCheck({
  state,
}: {
  state: PublishMediaCheckState;
}) {
  if (state.status === "checking") {
    return (
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <LoaderCircle className="size-3 animate-spin" aria-hidden="true" />
        Checking this release&apos;s images…
      </p>
    );
  }
  if (state.status === "failed") {
    return (
      <p className="text-xs text-muted-foreground">
        Could not check this release&apos;s images. You can still publish.
      </p>
    );
  }
  if (state.brokenImages.length === 0) return null;

  const listed = state.brokenImages.slice(0, MAX_LISTED);
  const more = state.brokenImages.length - listed.length;
  return (
    <div
      role="alert"
      className="space-y-1.5 rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-xs"
    >
      <p className="flex gap-1.5 font-medium text-foreground">
        <AlertTriangle
          className="mt-0.5 size-3.5 shrink-0 text-amber-500"
          aria-hidden="true"
        />
        {state.brokenImages.length === 1
          ? "1 image will not show to visitors"
          : `${state.brokenImages.length} images will not show to visitors`}
      </p>
      <p className="text-muted-foreground">
        These fields store a library image as a CMS URL, which the storefront
        cannot serve. Choose the image again from Assets; a field that does not
        offer Assets has to be declared as an image field first.
      </p>
      <ul className="space-y-0.5 font-mono text-[11px] text-foreground/80">
        {listed.map((place, index) => (
          <li key={`${index}:${place}`} className="truncate" title={place}>
            {place}
          </li>
        ))}
        {more > 0 ? (
          <li className="text-muted-foreground">and {more} more</li>
        ) : null}
      </ul>
    </div>
  );
}
