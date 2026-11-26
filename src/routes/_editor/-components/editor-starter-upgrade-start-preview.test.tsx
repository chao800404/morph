import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StorefrontThemeEditorDTO } from "@/lib/storefront/dto/storefront-theme.dto";

const fns = vi.hoisted(() => ({
  review: vi.fn(),
  apply: vi.fn(),
  setRuntime: vi.fn(),
}));

vi.mock("@/server/storefront/storefront-themes.serverFn", () => ({
  reviewStorefrontStarterUpgrade: fns.review,
  applyStorefrontStarterUpgrade: fns.apply,
}));
vi.mock("@/server/storefront/storefront-theme-preview-server.serverFn", () => ({
  setThemePreviewRuntime: (args: unknown) => fns.setRuntime(args),
}));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

import { EditorStarterUpgradeNotice } from "./editor-starter-upgrade-notice";

/**
 * A Starter upgrade whose selected files need the full Start Live Preview
 * (Starter 32's content module reads through a server function), on a Theme
 * that does not record `start`. The server refuses such an apply with
 * nothing written (STARTER_UPGRADE_START_PREVIEW_REQUIRED); the dialog says
 * so before Apply, blocks Apply, and offers the editor's own runtime switch.
 * Switching and applying stay two actions of the author's.
 */

const START_MESSAGE =
  "This Starter upgrade includes pages that read their content on the server, which only the full Start preview can show. Switch this Theme's preview to Start first; until then nothing of this upgrade is applied.";
const CONTENT = "src/morph/content.ts";
const STARTER_DIGEST = "a".repeat(64);
const CATALOG_DIGEST = "b".repeat(64);

const STARTER_PART = {
  applies: true,
  digest: STARTER_DIGEST,
  changes: [
    {
      path: CONTENT,
      operation: "update",
      before: "export const v = 31;\n",
      after: "export const v = 32;\n",
    },
  ],
  kept: [],
  optional: null,
};

const NO_CATALOG = {
  applies: true,
  kind: null,
  digest: CATALOG_DIGEST,
  changes: [],
  kept: [],
};

const CATALOG_PART = {
  applies: true,
  kind: "install",
  digest: CATALOG_DIGEST,
  changes: [
    {
      path: "src/routes/products.index.tsx",
      operation: "create",
      before: null,
      after: "export const Route = 1;\n",
    },
  ],
  kept: [],
};

const NEEDS_START = { paths: [CONTENT], satisfied: false, reason: START_MESSAGE };
const ON_START = { paths: [CONTENT], satisfied: true, reason: null };

function reviewOf(overrides: Record<string, unknown> = {}) {
  return {
    sourceGeneration: 7,
    versionState: "available",
    storedVersion: 31,
    currentVersion: 32,
    starter: STARTER_PART,
    catalog: NO_CATALOG,
    startPreview: NEEDS_START,
    ...overrides,
  };
}

function editorContext(): StorefrontThemeEditorDTO {
  return {
    storefront: {
      id: "storefront-a",
      name: "Store",
      domain: null,
      status: "published",
      activeReleaseId: null,
    },
    theme: {
      id: "theme-a",
      name: "Default",
      status: "draft",
      releaseGeneration: 1,
      framework: null,
      previewRuntime: null,
      activeRelease: null,
    },
    templates: [],
  } as StorefrontThemeEditorDTO;
}

function renderNotice() {
  const onApplied = vi.fn();
  const onPreviewRuntimeChanged = vi.fn();
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <EditorStarterUpgradeNotice
        status={{
          versionState: "available",
          storedVersion: 31,
          currentVersion: 32,
          catalogPending: null,
        }}
        storefrontId="storefront-a"
        themeId="theme-a"
        unsavedCount={0}
        onApplied={onApplied}
        context={editorContext()}
        onPreviewRuntimeChanged={onPreviewRuntimeChanged}
      />
    </QueryClientProvider>,
  );
  return { onApplied, onPreviewRuntimeChanged };
}

async function openReview() {
  fireEvent.click(screen.getByRole("button", { name: "Review upgrade" }));
  return screen.findByRole("dialog", { name: "Review the Starter upgrade" });
}

const applyButton = () =>
  screen.getByRole("button", { name: "Apply selected" }) as HTMLButtonElement;
const switchButton = (dialog: HTMLElement) =>
  within(dialog).getByRole("button", {
    name: "Switch Live Preview to Full Start",
  }) as HTMLButtonElement;

beforeEach(() => {
  fns.review.mockReset();
  fns.apply.mockReset();
  fns.setRuntime.mockReset();
  fns.review.mockResolvedValue({ success: true, data: reviewOf() });
  fns.apply.mockResolvedValue({
    success: true,
    data: {
      status: "applied",
      filesSaved: true,
      sourceGeneration: 8,
      starter: true,
      versionRecorded: true,
      catalog: false,
    },
  });
});

describe("a Starter upgrade that needs the full Start Live Preview", () => {
  it("says so before Apply, names the file, and blocks Apply", async () => {
    renderNotice();
    const dialog = await openReview();
    const notice = within(dialog).getByRole("alert");
    expect(notice.textContent).toContain(
      "This upgrade needs the full Start Live Preview.",
    );
    expect(notice.textContent).toContain(CONTENT);
    expect(notice.textContent).toContain(START_MESSAGE);
    expect(applyButton().disabled).toBe(true);
    fireEvent.click(applyButton());
    expect(fns.apply).not.toHaveBeenCalled();
  });

  it("switches through the editor's own runtime write, applies nothing, and reads the review again", async () => {
    fns.setRuntime.mockResolvedValue({
      success: true,
      data: { previewRuntime: "start" },
    });
    const { onPreviewRuntimeChanged } = renderNotice();
    const dialog = await openReview();
    fns.review.mockResolvedValue({
      success: true,
      data: reviewOf({ startPreview: ON_START }),
    });
    fireEvent.click(switchButton(dialog));
    await waitFor(() => expect(fns.review).toHaveBeenCalledTimes(2));
    expect(fns.setRuntime).toHaveBeenCalledWith({
      data: {
        storefrontId: "storefront-a",
        themeId: "theme-a",
        previewRuntime: "start",
        expectedPreviewRuntime: null,
      },
    });
    expect(onPreviewRuntimeChanged).toHaveBeenCalledTimes(1);
    // Applying is the author's own next step.
    expect(fns.apply).not.toHaveBeenCalled();
    await waitFor(() => expect(applyButton().disabled).toBe(false));
    expect(
      within(
        screen.getByRole("dialog", { name: "Review the Starter upgrade" }),
      ).queryByRole("alert"),
    ).toBeNull();
    fireEvent.click(applyButton());
    await waitFor(() => expect(fns.apply).toHaveBeenCalledTimes(1));
  });

  it("keeps Apply blocked and says why when the switch is refused or the runtime changed elsewhere", async () => {
    fns.setRuntime.mockResolvedValue({
      success: false,
      error: "PREVIEW_RUNTIME_CONFLICT",
      message: "changed",
      previewRuntime: "client",
    });
    renderNotice();
    const dialog = await openReview();
    fireEvent.click(switchButton(dialog));
    await waitFor(() =>
      expect(within(dialog).getByRole("alert").textContent).toContain(
        "The Live Preview runtime was changed elsewhere, so nothing was switched.",
      ),
    );
    expect(fns.review).toHaveBeenCalledTimes(1);
    expect(applyButton().disabled).toBe(true);
    expect(fns.apply).not.toHaveBeenCalled();
  });

  it("keeps Apply blocked when the switch fails", async () => {
    fns.setRuntime.mockRejectedValue(new Error("network down"));
    renderNotice();
    const dialog = await openReview();
    fireEvent.click(switchButton(dialog));
    await waitFor(() =>
      expect(within(dialog).getByRole("alert").textContent).toContain("network down"),
    );
    expect(applyButton().disabled).toBe(true);
    expect(fns.apply).not.toHaveBeenCalled();
  });

  it("still applies the product catalog alone", async () => {
    fns.review.mockResolvedValue({
      success: true,
      data: reviewOf({ catalog: CATALOG_PART }),
    });
    renderNotice();
    const dialog = await openReview();
    expect(applyButton().disabled).toBe(true);
    fireEvent.click(
      within(dialog).getByRole("checkbox", { name: "Apply the Starter upgrade" }),
    );
    expect(applyButton().disabled).toBe(false);
    expect(within(dialog).queryByRole("alert")).toBeNull();
    fireEvent.click(applyButton());
    await waitFor(() => expect(fns.apply).toHaveBeenCalledTimes(1));
    expect(fns.apply).toHaveBeenCalledWith({
      data: {
        storefrontId: "storefront-a",
        themeId: "theme-a",
        expectedSourceGeneration: 7,
        catalogDigest: CATALOG_DIGEST,
      },
    });
  });

  it("applies a Starter plan that writes no Start-only file, such as one keeping the author's module", async () => {
    fns.review.mockResolvedValue({
      success: true,
      data: reviewOf({
        starter: {
          ...STARTER_PART,
          changes: [],
          kept: [{ path: CONTENT, reason: "changed" }],
        },
        // The Start-only path the response names belongs to a plan not selected.
        startPreview: NEEDS_START,
      }),
    });
    renderNotice();
    const dialog = await openReview();
    expect(within(dialog).queryByRole("alert")).toBeNull();
    expect(applyButton().disabled).toBe(false);
    fireEvent.click(applyButton());
    await waitFor(() => expect(fns.apply).toHaveBeenCalledTimes(1));
  });

  it("shows a refusal that arrives anyway inside the dialog, and blocks Apply again", async () => {
    // Reviewed on start; switched back elsewhere before the apply.
    fns.review.mockResolvedValue({
      success: true,
      data: reviewOf({ startPreview: ON_START }),
    });
    fns.apply.mockResolvedValue({
      success: false,
      error: "STARTER_UPGRADE_START_PREVIEW_REQUIRED",
      message: START_MESSAGE,
    });
    renderNotice();
    const dialog = await openReview();
    expect(applyButton().disabled).toBe(false);
    fireEvent.click(applyButton());
    await waitFor(() =>
      expect(within(dialog).getByRole("alert").textContent).toContain(START_MESSAGE),
    );
    expect(screen.getByRole("dialog", { name: "Review the Starter upgrade" })).toBe(
      dialog,
    );
    expect(applyButton().disabled).toBe(true);
    expect(switchButton(dialog)).toBeTruthy();
  });
});
