import { checkStorefrontPublishScope } from "@/server/storefront/storefront-publish-check.serverFn";
import { Button } from "@/components/ui/button";
import { queryOptions } from "@tanstack/react-query";
import { Layers, LoaderCircle } from "lucide-react";

/**
 * What a page publish puts live besides the page, asked when the Publish
 * confirmation opens.
 *
 * The server answers from the same selection `publishTemplate` seals
 * (`findPublishScope`), and the revision it names is sent back with the
 * publish: a layout that moved on in between refuses the publish rather than
 * going live unseen (`PUBLISH_SCOPE_CHANGED`).
 */
export const publishScopeQuery = (
  ids: { storefrontId: string; themeId: string; templateId: string },
  /**
   * Run before the read: commits the layout's pending edits, so a Header
   * change still in its save debounce is part of the answer rather than a
   * draft written after it (which the publish would then refuse).
   */
  beforeRead?: () => Promise<void>,
) =>
  queryOptions({
    queryKey: ["storefront-publish-scope", ids],
    queryFn: async () => {
      await beforeRead?.();
      return checkStorefrontPublishScope({ data: ids });
    },
    // The answer is about the drafts as they are now.
    staleTime: 0,
    gcTime: 0,
    retry: false,
  });

export type PublishScopeState =
  | { status: "checking" }
  | { status: "failed" }
  | {
      status: "done";
      /** The layout's pending draft the publish seals, or null for none. */
      sharedLayoutRevisionId: string | null;
      /** The layout's draft as the confirmation read it (null: none yet). */
      layoutDraftRevisionId: string | null;
      /**
       * The layout has never been published and has no draft: this publish
       * writes its first draft and seals it, so it goes live too.
       */
      layoutFirstPublish: boolean;
    };

export function publishScopeState(query: {
  isPending: boolean;
  isFetching?: boolean;
  isError: boolean;
  data?: {
    success: boolean;
    data?: {
      sharedLayout: { templateId: string; revisionId: string } | null;
      layout: {
        templateId: string;
        draftRevisionId: string | null;
        firstPublish: boolean;
      } | null;
    } | null;
  };
}): PublishScopeState {
  // A refetch is a new question: the previous answer may no longer hold, and
  // confirming against it would only be refused.
  if (query.isPending || query.isFetching) return { status: "checking" };
  if (query.isError || !query.data?.success || !query.data.data) {
    return { status: "failed" };
  }
  const { sharedLayout, layout } = query.data.data;
  return {
    status: "done",
    sharedLayoutRevisionId: sharedLayout?.revisionId ?? null,
    layoutDraftRevisionId: layout?.draftRevisionId ?? null,
    layoutFirstPublish: layout?.firstPublish ?? false,
  };
}

/** Whether the confirmation says the shared layout goes live with the page. */
export function publishScopeIncludesLayout(
  state: Extract<PublishScopeState, { status: "done" }>,
) {
  return state.sharedLayoutRevisionId !== null || state.layoutFirstPublish;
}

/** A confirmed scope, as `handlePublish` carries it to the publish. */
export type PublishScopeExpectation = Readonly<{
  /** Sent with the publish: the pending layout revision it may seal. */
  expectedSharedLayoutRevisionId: string | null;
  /** The layout draft this scope describes (null: none yet). */
  layoutDraftRevisionId: string | null;
}>;

/**
 * The scope a confirmation may publish with, or null while it is unknown.
 * Unknown never reads as "this page only": the author cannot confirm a scope
 * nobody established.
 */
export function publishScopeExpectation(
  state: PublishScopeState,
): PublishScopeExpectation | null {
  return state.status === "done"
    ? {
        expectedSharedLayoutRevisionId: state.sharedLayoutRevisionId,
        layoutDraftRevisionId: state.layoutDraftRevisionId,
      }
    : null;
}

/**
 * What this publish's own draft preparation did to the layout: the draft it
 * started from (null: none) and the draft it left. Chained across the
 * preparations one publish makes, so `fromRevisionId` stays the first base.
 */
export type LayoutPreparation = Readonly<{
  fromRevisionId: string | null;
  revisionId: string;
}>;

export function chainLayoutPreparation(
  previous: LayoutPreparation | null,
  fromRevisionId: string | null,
  revisionId: string,
): LayoutPreparation {
  return {
    fromRevisionId:
      previous && previous.revisionId === fromRevisionId
        ? previous.fromRevisionId
        : fromRevisionId,
    revisionId,
  };
}

/**
 * The confirmed scope restated for the drafts this publish itself prepared.
 *
 * Preparing the layout for a build seal writes a layout revision (its first
 * draft, or a branch of one a publication pins) with the content it started
 * from, after the confirmation read the scope. When that preparation started
 * from exactly the draft the confirmation described, the revision it left is
 * the one the author confirmed, and the publish is sent with it. Any other
 * base is a change nobody confirmed: the scope stays as read and the server
 * refuses the publish (`PUBLISH_SCOPE_CHANGED`).
 */
export function publishScopeAfterPreparation(
  scope: PublishScopeExpectation,
  preparation: LayoutPreparation | null,
): PublishScopeExpectation {
  if (
    !preparation ||
    preparation.fromRevisionId !== scope.layoutDraftRevisionId
  ) {
    return scope;
  }
  return {
    expectedSharedLayoutRevisionId: preparation.revisionId,
    layoutDraftRevisionId: preparation.revisionId,
  };
}

/** The confirmation button, given the media check's and the scope's state. */
export function publishScopeConfirmation(
  base: { disabled: boolean; label: string },
  state: PublishScopeState,
): { disabled: boolean; label: string } {
  if (state.status !== "done") return { disabled: true, label: base.label };
  if (publishScopeIncludesLayout(state) && base.label === "Publish") {
    return { disabled: base.disabled, label: "Publish page and layout" };
  }
  return base;
}

export function EditorPublishScope({
  state,
  onRetry,
}: {
  state: PublishScopeState;
  onRetry: () => void;
}) {
  if (state.status === "checking") {
    return (
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <LoaderCircle className="size-3 animate-spin" aria-hidden="true" />
        Checking what this publish includes…
      </p>
    );
  }
  if (state.status === "failed") {
    return (
      <div
        role="alert"
        data-publish-scope="unknown"
        className="space-y-1.5 rounded-md border border-border p-2 text-xs"
      >
        <p className="text-muted-foreground">
          Could not check whether the shared layout will be published too. Check
          again before publishing.
        </p>
        <Button type="button" size="xs" variant="outline" onClick={onRetry}>
          Check again
        </Button>
      </div>
    );
  }
  // This page only: the confirmation reads as it always has.
  if (!publishScopeIncludesLayout(state)) return null;
  return (
    <div
      role="status"
      data-publish-scope="page-and-layout"
      className="space-y-1 rounded-md border border-primary/30 bg-primary/5 p-2 text-xs"
    >
      <p className="flex gap-1.5 font-medium text-foreground">
        <Layers
          className="mt-0.5 size-3.5 shrink-0 text-primary"
          aria-hidden="true"
        />
        Publish this page and the shared layout
      </p>
      <p className="text-muted-foreground">
        Your shared layout changes, such as the header or footer, go live with
        this page. Other pages will also show the updated shared layout; their
        own drafts stay unpublished.
      </p>
    </div>
  );
}
