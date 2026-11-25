import { fireEvent, render, screen } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";

const checkScope = vi.hoisted(() => vi.fn());
vi.mock("@/server/storefront/storefront-publish-check.serverFn", () => ({
  checkStorefrontPublishScope: checkScope,
}));

import {
  chainLayoutPreparation,
  EditorPublishScope,
  publishScopeAfterPreparation,
  publishScopeConfirmation,
  publishScopeExpectation,
  publishScopeQuery,
  publishScopeState,
} from "./editor-publish-scope";

const LAYOUT_REVISION = "77777777-7777-4777-8777-777777777777";
const PUBLISHED_LAYOUT = "66666666-6666-4666-8666-666666666666";
const PREPARED_LAYOUT = "88888888-8888-4888-8888-888888888888";
const OTHER_LAYOUT = "99999999-9999-4999-8999-999999999999";
const layoutRow = (draftRevisionId: string | null, firstPublish = false) => ({
  templateId: "layout",
  draftRevisionId,
  firstPublish,
});
const ids = { storefrontId: "store", themeId: "theme", templateId: "home" };

describe("no shared layout pending", () => {
  const state = publishScopeState({
    isPending: false,
    isError: false,
    data: {
      success: true,
      data: { sharedLayout: null, layout: layoutRow(PUBLISHED_LAYOUT) },
    },
  });

  it("reads as this page only and publishes with that scope", () => {
    expect(state).toEqual({
      status: "done",
      sharedLayoutRevisionId: null,
      layoutDraftRevisionId: PUBLISHED_LAYOUT,
      layoutFirstPublish: false,
    });
    expect(publishScopeExpectation(state)).toEqual({
      expectedSharedLayoutRevisionId: null,
      layoutDraftRevisionId: PUBLISHED_LAYOUT,
    });
    expect(
      publishScopeConfirmation({ disabled: false, label: "Publish" }, state),
    ).toEqual({ disabled: false, label: "Publish" });
  });

  it("leaves the confirmation as it was", () => {
    const { container } = render(
      <EditorPublishScope state={state} onRetry={() => {}} />,
    );
    expect(container.innerHTML).toBe("");
  });
});

describe("a shared layout pending", () => {
  const state = publishScopeState({
    isPending: false,
    isError: false,
    data: {
      success: true,
      data: {
        sharedLayout: { templateId: "layout", revisionId: LAYOUT_REVISION },
        layout: layoutRow(LAYOUT_REVISION),
      },
    },
  });

  it("names the layout revision the publish is confirmed for", () => {
    expect(state).toEqual({
      status: "done",
      sharedLayoutRevisionId: LAYOUT_REVISION,
      layoutDraftRevisionId: LAYOUT_REVISION,
      layoutFirstPublish: false,
    });
    expect(publishScopeExpectation(state)).toEqual({
      expectedSharedLayoutRevisionId: LAYOUT_REVISION,
      layoutDraftRevisionId: LAYOUT_REVISION,
    });
    expect(
      publishScopeConfirmation({ disabled: false, label: "Publish" }, state),
    ).toEqual({ disabled: false, label: "Publish page and layout" });
    // The media check's own wording and hold still win.
    expect(
      publishScopeConfirmation(
        { disabled: false, label: "Publish anyway" },
        state,
      ),
    ).toEqual({ disabled: false, label: "Publish anyway" });
  });

  it("says the page and the shared layout go live, and other pages show it", () => {
    render(<EditorPublishScope state={state} onRetry={() => {}} />);
    expect(
      screen.getByText("Publish this page and the shared layout"),
    ).toBeTruthy();
    expect(
      screen.getByText(/Other pages will also show the updated shared layout/),
    ).toBeTruthy();
  });
});

describe("a layout that has never been published", () => {
  // No draft yet: the publish writes the layout's first one and seals it.
  const state = publishScopeState({
    isPending: false,
    isError: false,
    data: {
      success: true,
      data: { sharedLayout: null, layout: layoutRow(null, true) },
    },
  });

  it("says the layout goes live with the page", () => {
    expect(
      publishScopeConfirmation({ disabled: false, label: "Publish" }, state),
    ).toEqual({ disabled: false, label: "Publish page and layout" });
    render(<EditorPublishScope state={state} onRetry={() => {}} />);
    expect(
      screen.getByText("Publish this page and the shared layout"),
    ).toBeTruthy();
  });
});

describe("the publish's own layout preparation", () => {
  it("first publish: the first draft it writes is the layout the author confirmed", () => {
    const scope = {
      expectedSharedLayoutRevisionId: null,
      layoutDraftRevisionId: null,
    };
    const prepared = chainLayoutPreparation(null, null, PREPARED_LAYOUT);
    expect(publishScopeAfterPreparation(scope, prepared)).toEqual({
      expectedSharedLayoutRevisionId: PREPARED_LAYOUT,
      layoutDraftRevisionId: PREPARED_LAYOUT,
    });
  });

  it("an untouched layout left as it is: this page only stays this page only", () => {
    // The preparation returns the layout's own published revision and writes
    // nothing, so the layout is carried, not pending: the server still seals
    // no shared layout and expects null.
    const scope = {
      expectedSharedLayoutRevisionId: null,
      layoutDraftRevisionId: PUBLISHED_LAYOUT,
    };
    const prepared = chainLayoutPreparation(
      null,
      PUBLISHED_LAYOUT,
      PUBLISHED_LAYOUT,
    );
    expect(publishScopeAfterPreparation(scope, prepared)).toBe(scope);
    expect(
      publishScopeAfterPreparation(scope, prepared)
        .expectedSharedLayoutRevisionId,
    ).toBeNull();
    // Prepared twice in one publish, still nothing written.
    expect(
      publishScopeAfterPreparation(
        scope,
        chainLayoutPreparation(prepared, PUBLISHED_LAYOUT, PUBLISHED_LAYOUT),
      ),
    ).toBe(scope);
  });

  it("a layout re-prepared into a new revision from the confirmed draft: sent for that revision", () => {
    const scope = {
      expectedSharedLayoutRevisionId: null,
      layoutDraftRevisionId: PUBLISHED_LAYOUT,
    };
    expect(
      publishScopeAfterPreparation(
        scope,
        chainLayoutPreparation(null, PUBLISHED_LAYOUT, PREPARED_LAYOUT),
      ),
    ).toEqual({
      expectedSharedLayoutRevisionId: PREPARED_LAYOUT,
      layoutDraftRevisionId: PREPARED_LAYOUT,
    });
  });

  it("a pending layout prepared in place or branched: sent for the draft it left", () => {
    const scope = {
      expectedSharedLayoutRevisionId: LAYOUT_REVISION,
      layoutDraftRevisionId: LAYOUT_REVISION,
    };
    // Prepared in place: nothing new was written, the confirmed scope stands.
    expect(
      publishScopeAfterPreparation(
        scope,
        chainLayoutPreparation(null, LAYOUT_REVISION, LAYOUT_REVISION),
      ),
    ).toBe(scope);
    expect(
      publishScopeAfterPreparation(
        scope,
        chainLayoutPreparation(null, LAYOUT_REVISION, PREPARED_LAYOUT),
      ).expectedSharedLayoutRevisionId,
    ).toBe(PREPARED_LAYOUT);
  });

  it("two preparations in one publish keep the first base", () => {
    const first = chainLayoutPreparation(
      null,
      PUBLISHED_LAYOUT,
      PREPARED_LAYOUT,
    );
    const second = chainLayoutPreparation(first, PREPARED_LAYOUT, OTHER_LAYOUT);
    expect(second).toEqual({
      fromRevisionId: PUBLISHED_LAYOUT,
      revisionId: OTHER_LAYOUT,
    });
    expect(
      publishScopeAfterPreparation(
        {
          expectedSharedLayoutRevisionId: null,
          layoutDraftRevisionId: PUBLISHED_LAYOUT,
        },
        second,
      ).expectedSharedLayoutRevisionId,
    ).toBe(OTHER_LAYOUT);
  });

  it("a preparation from any other layout draft is not confirmed: the scope stays as read", () => {
    const scope = {
      expectedSharedLayoutRevisionId: null,
      layoutDraftRevisionId: PUBLISHED_LAYOUT,
    };
    // The layout moved on (an edit after the confirmation read it) before
    // the publish prepared it: the server refuses the publish.
    expect(
      publishScopeAfterPreparation(
        scope,
        chainLayoutPreparation(null, OTHER_LAYOUT, PREPARED_LAYOUT),
      ),
    ).toBe(scope);
    expect(publishScopeAfterPreparation(scope, null)).toBe(scope);
    // The same holds for a confirmed pending layout.
    const pending = {
      expectedSharedLayoutRevisionId: LAYOUT_REVISION,
      layoutDraftRevisionId: LAYOUT_REVISION,
    };
    expect(
      publishScopeAfterPreparation(
        pending,
        chainLayoutPreparation(null, OTHER_LAYOUT, PREPARED_LAYOUT),
      ),
    ).toBe(pending);
  });
});

describe("the scope read fails", () => {
  it.each([
    { isPending: false, isError: true },
    { isPending: false, isError: false, data: { success: false, data: null } },
  ])("is unknown, never this page only (%o)", (query) => {
    const state = publishScopeState(query);
    expect(state).toEqual({ status: "failed" });
    expect(publishScopeExpectation(state)).toBeNull();
    expect(
      publishScopeConfirmation({ disabled: false, label: "Publish" }, state),
    ).toEqual({ disabled: true, label: "Publish" });
  });

  it("says so neutrally and offers to check again", () => {
    const onRetry = vi.fn();
    render(
      <EditorPublishScope state={{ status: "failed" }} onRetry={onRetry} />,
    );
    expect(
      screen.getByText(/Could not check whether the shared layout/),
    ).toBeTruthy();
    expect(screen.queryByText(/this page only/i)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Check again" }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it("holds the confirmation while the read is still out", () => {
    for (const query of [
      { isPending: true, isError: false },
      // A refetch after "Check again": the earlier answer no longer holds.
      {
        isPending: false,
        isFetching: true,
        isError: false,
        data: { success: true, data: { sharedLayout: null, layout: null } },
      },
    ]) {
      const state = publishScopeState(query);
      expect(state).toEqual({ status: "checking" });
      expect(publishScopeExpectation(state)).toBeNull();
      expect(
        publishScopeConfirmation({ disabled: false, label: "Publish" }, state),
      ).toMatchObject({ disabled: true });
    }
  });
});

describe("publishScopeQuery", () => {
  it("commits the layout's pending edits before asking, so they are in the answer", async () => {
    const order: string[] = [];
    checkScope.mockImplementation(async () => {
      order.push("read");
      return { success: true, data: { sharedLayout: null, layout: null } };
    });
    const client = new QueryClient();
    await client.fetchQuery(
      publishScopeQuery(ids, async () => {
        order.push("flush");
      }),
    );
    expect(order).toEqual(["flush", "read"]);
    expect(checkScope).toHaveBeenCalledWith({ data: ids });
  });
});
