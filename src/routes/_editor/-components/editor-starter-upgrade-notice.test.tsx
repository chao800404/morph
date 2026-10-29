import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
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

const STARTER_DIGEST = "a".repeat(64);
const CATALOG_DIGEST = "b".repeat(64);

const STARTER_PART = {
  applies: true,
  digest: STARTER_DIGEST,
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

const NO_CATALOG = {
  applies: true,
  kind: null,
  digest: CATALOG_DIGEST,
  changes: [],
  kept: [],
};

function reviewOf(overrides: Record<string, unknown> = {}) {
  return {
    sourceGeneration: 7,
    versionState: "available",
    storedVersion: 28,
    currentVersion: 29,
    starter: STARTER_PART,
    catalog: NO_CATALOG,
    ...overrides,
  };
}

const AVAILABLE = {
  versionState: "available" as const,
  storedVersion: 28,
  currentVersion: 29,
  catalogPending: null,
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
        status={AVAILABLE}
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

async function openReview() {
  fireEvent.click(screen.getByRole("button", { name: "Review upgrade" }));
  return screen.findByRole("dialog", { name: "Review the Starter upgrade" });
}

beforeEach(() => {
  fns.review.mockReset();
  fns.apply.mockReset();
  fns.review.mockResolvedValue({ success: true, data: reviewOf() });
  fns.apply.mockResolvedValue({
    success: true,
    data: {
      status: "applied",
      filesSaved: true,
      sourceGeneration: 8,
      starter: true,
      catalog: false,
    },
  });
});

describe("EditorStarterUpgradeNotice", () => {
  it("shows nothing when the Starter is current and the catalog has nothing waiting", () => {
    renderNotice({
      status: { ...AVAILABLE, versionState: "current", storedVersion: 29 },
    });
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("says an unknown version is pending, not the latest", () => {
    renderNotice({
      status: { ...AVAILABLE, versionState: "pending", storedVersion: null },
    });
    const notice = screen.getByRole("status");
    expect(notice.getAttribute("data-editor-starter-upgrade")).toBe("pending");
    expect(notice.textContent).toContain(
      "does not record which Starter it came from",
    );
    expect(notice.textContent).toContain("Nothing changes until you apply it.");
  });

  it("shows the notice when only the catalog has something to install, and names the pages it would add", () => {
    renderNotice({
      status: {
        ...AVAILABLE,
        versionState: "current",
        storedVersion: 29,
        catalogPending: "install",
      },
    });
    const notice = screen.getByRole("status");
    expect(notice.getAttribute("data-editor-starter-upgrade")).toBe("catalog");
    expect(notice.getAttribute("data-catalog-pending")).toBe("install");
    expect(notice.textContent).toContain(
      "a product list page (/products) and a product detail page (/products/<slug>)",
    );
    expect(notice.textContent).toContain(
      "These pages are not created until you review and apply them.",
    );
  });

  it("says an update leaves the catalog pages as they are until applied", () => {
    renderNotice({
      status: {
        ...AVAILABLE,
        versionState: "current",
        storedVersion: 29,
        catalogPending: "update",
      },
    });
    const notice = screen.getByRole("status");
    expect(notice.getAttribute("data-catalog-pending")).toBe("update");
    expect(notice.textContent).toContain(
      "They stay as they are until you review and apply them.",
    );
    expect(notice.textContent).not.toContain("product list page");
  });

  it("reviews without writing, shows each change and each kept file, and applies exactly that review", async () => {
    const { onApplied } = renderNotice();
    const dialog = await openReview();
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
    // No catalog section when the catalog has nothing to show.
    expect(
      within(dialog).queryByRole("region", { name: "Product catalog" }),
    ).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Apply selected" }));
    await waitFor(() => expect(onApplied).toHaveBeenCalledTimes(1));
    expect(fns.apply).toHaveBeenCalledWith({
      data: {
        storefrontId: "storefront-a",
        themeId: "theme-a",
        expectedSourceGeneration: 7,
        starterDigest: STARTER_DIGEST,
      },
    });
  });

  it("keeps the Starter upgrade and the product catalog apart, and applies only the parts chosen", async () => {
    fns.review.mockResolvedValue({
      success: true,
      data: reviewOf({ catalog: CATALOG_PART }),
    });
    const { onApplied } = renderNotice({
      status: { ...AVAILABLE, catalogPending: "install" },
    });
    const dialog = await openReview();
    const starter = within(dialog).getByRole("region", {
      name: "Starter upgrade",
    });
    const catalog = within(dialog).getByRole("region", {
      name: "Product catalog",
    });
    expect(starter.textContent).toContain("src/morph/content.ts");
    expect(starter.textContent).not.toContain("products.index.tsx");
    expect(catalog.textContent).toContain("src/routes/products.index.tsx");
    expect(catalog.textContent).toContain(
      "does not change the Starter version",
    );
    expect(catalog.textContent).toContain(
      "They are not created until you apply this part.",
    );

    fireEvent.click(
      within(catalog).getByRole("button", { name: /products\.index\.tsx/ }),
    );
    expect(
      screen.getByLabelText("Changes to src/routes/products.index.tsx")
        .textContent,
    ).toContain("+ export const Route = 1;");

    // The catalog alone: the Starter part is left out of the apply.
    fireEvent.click(
      within(starter).getByRole("checkbox", {
        name: "Apply the Starter upgrade",
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Apply selected" }));
    await waitFor(() => expect(onApplied).toHaveBeenCalledTimes(1));
    expect(fns.apply).toHaveBeenCalledWith({
      data: {
        storefrontId: "storefront-a",
        themeId: "theme-a",
        expectedSourceGeneration: 7,
        catalogDigest: CATALOG_DIGEST,
      },
    });
  });

  it("does not apply while this tab has unsaved changes", async () => {
    renderNotice({ unsavedCount: 2 });
    await openReview();
    expect(
      (
        screen.getByRole("button", {
          name: "Apply selected",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    expect(
      screen.getByText("Save or discard your unsaved changes first."),
    ).toBeTruthy();
  });

  it("keeps the notice and asks for a new review when the Theme moved on since", async () => {
    fns.apply.mockResolvedValue({
      success: false,
      message:
        "The Theme changed since this upgrade was reviewed, so nothing was applied. Review it again.",
    });
    const { onApplied } = renderNotice();
    await openReview();
    fireEvent.click(screen.getByRole("button", { name: "Apply selected" }));

    await waitFor(() =>
      expect(
        screen.getByText(/nothing was applied\. Review it again\./),
      ).toBeTruthy(),
    );
    expect(onApplied).not.toHaveBeenCalled();
  });
});
