import { fireEvent, render, screen } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";

const checkScope = vi.hoisted(() => vi.fn());
vi.mock("@/server/storefront/storefront-publish-check.serverFn", () => ({
  checkStorefrontPublishScope: checkScope,
}));

import {
  EditorPublishScope,
  publishScopeConfirmation,
  publishScopeExpectation,
  publishScopeQuery,
  publishScopeState,
} from "./editor-publish-scope";

const LAYOUT_REVISION = "77777777-7777-4777-8777-777777777777";
const ids = { storefrontId: "store", themeId: "theme", templateId: "home" };

describe("no shared layout pending", () => {
  const state = publishScopeState({
    isPending: false,
    isError: false,
    data: { success: true, data: { sharedLayout: null } },
  });

  it("reads as this page only and publishes with that scope", () => {
    expect(state).toEqual({ status: "done", sharedLayoutRevisionId: null });
    expect(publishScopeExpectation(state)).toEqual({
      expectedSharedLayoutRevisionId: null,
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
      },
    },
  });

  it("names the layout revision the publish is confirmed for", () => {
    expect(state).toEqual({
      status: "done",
      sharedLayoutRevisionId: LAYOUT_REVISION,
    });
    expect(publishScopeExpectation(state)).toEqual({
      expectedSharedLayoutRevisionId: LAYOUT_REVISION,
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
        data: { success: true, data: { sharedLayout: null } },
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
      return { success: true, data: { sharedLayout: null } };
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
