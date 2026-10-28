import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const fns = vi.hoisted(() => ({
  review: vi.fn(),
  apply: vi.fn(),
}));

vi.mock("@/server/storefront/storefront-themes.serverFn", () => ({
  reviewStorefrontStarterUpgrade: fns.review,
  applyStorefrontStarterUpgrade: fns.apply,
}));

import { EditorStarterUpgradeNotice } from "./editor-starter-upgrade-notice";

const DIGEST = "a".repeat(64);

const REVIEW = {
  sourceGeneration: 7,
  versionState: "available",
  storedVersion: 28,
  currentVersion: 29,
  applies: true,
  digest: DIGEST,
  changes: [
    {
      path: "src/morph/content.ts",
      operation: "update",
      before: "export const a = 1;\nexport const keep = true;\n",
      after: "export const a = 2;\nexport const keep = true;\n",
    },
  ],
  kept: [
    { path: "src/components/Hero.tsx", reason: "changed" },
    { path: "src/routes/about.tsx", reason: "missing" },
  ],
};

function renderNotice(
  props: Partial<Parameters<typeof EditorStarterUpgradeNotice>[0]> = {},
) {
  const onApplied = vi.fn();
  const client = new QueryClient({
    defaultOptions: { mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <EditorStarterUpgradeNotice
        status={{
          versionState: "available",
          storedVersion: 28,
          currentVersion: 29,
        }}
        storefrontId="storefront-a"
        themeId="theme-a"
        unsavedCount={0}
        onApplied={onApplied}
        {...props}
      />
    </QueryClientProvider>,
  );
  return { onApplied };
}

beforeEach(() => {
  fns.review.mockReset();
  fns.apply.mockReset();
  fns.review.mockResolvedValue({ success: true, data: REVIEW });
  fns.apply.mockResolvedValue({
    success: true,
    data: { status: "applied", filesSaved: true, sourceGeneration: 8 },
  });
});

describe("EditorStarterUpgradeNotice", () => {
  it("shows nothing for a Theme on the current Starter", () => {
    renderNotice({
      status: {
        versionState: "current",
        storedVersion: 29,
        currentVersion: 29,
      },
    });
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("says an unknown version is pending, not the latest", () => {
    renderNotice({
      status: {
        versionState: "pending",
        storedVersion: null,
        currentVersion: 29,
      },
    });
    const notice = screen.getByRole("status");
    expect(notice.getAttribute("data-editor-starter-upgrade")).toBe("pending");
    expect(notice.textContent).toContain(
      "does not record which Starter it came from",
    );
    expect(notice.textContent).toContain("Nothing changes until you apply it.");
  });

  it("reviews without writing, shows each change and each kept file, and applies exactly that review", async () => {
    const { onApplied } = renderNotice();

    fireEvent.click(screen.getByRole("button", { name: "Review upgrade" }));
    const dialog = await screen.findByRole("dialog", {
      name: "Review the Starter upgrade",
    });
    expect(fns.review).toHaveBeenCalledWith({
      data: { storefrontId: "storefront-a", themeId: "theme-a" },
    });
    expect(fns.apply).not.toHaveBeenCalled();

    const diff = screen.getByLabelText("Changes to src/morph/content.ts");
    expect(diff.textContent).toContain("- export const a = 1;");
    expect(diff.textContent).toContain("+ export const a = 2;");
    expect(diff.textContent).toContain("  export const keep = true;");
    expect(dialog.textContent).toContain("src/components/Hero.tsx");
    expect(dialog.textContent).toContain("formatting-only changes");
    expect(dialog.textContent).toContain("not added back");

    fireEvent.click(screen.getByRole("button", { name: "Apply upgrade" }));
    await waitFor(() => expect(onApplied).toHaveBeenCalledTimes(1));
    expect(fns.apply).toHaveBeenCalledWith({
      data: {
        storefrontId: "storefront-a",
        themeId: "theme-a",
        expectedSourceGeneration: 7,
        planDigest: DIGEST,
      },
    });
  });

  it("does not apply while this tab has unsaved changes", async () => {
    renderNotice({ unsavedCount: 2 });
    fireEvent.click(screen.getByRole("button", { name: "Review upgrade" }));
    await screen.findByRole("dialog", { name: "Review the Starter upgrade" });
    expect(
      (
        screen.getByRole("button", {
          name: "Apply upgrade",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    expect(
      screen.getByText("Save or discard your unsaved changes first."),
    ).toBeTruthy();
  });

  it("keeps the notice and says why when the Theme moved on since the review", async () => {
    fns.apply.mockResolvedValue({
      success: false,
      message:
        "The Theme changed since this upgrade was reviewed, so nothing was applied. Review it again.",
    });
    const { onApplied } = renderNotice();
    fireEvent.click(screen.getByRole("button", { name: "Review upgrade" }));
    await screen.findByRole("dialog", { name: "Review the Starter upgrade" });
    fireEvent.click(screen.getByRole("button", { name: "Apply upgrade" }));

    await waitFor(() =>
      expect(
        screen.getByText(/nothing was applied\. Review it again\./),
      ).toBeTruthy(),
    );
    expect(onApplied).not.toHaveBeenCalled();
  });
});
