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
      versionRecorded: true,
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

  it("says the notice stays when a Theme of unknown origin was only partly upgraded", async () => {
    fns.apply.mockResolvedValue({
      success: true,
      data: {
        status: "applied",
        filesSaved: true,
        sourceGeneration: 8,
        starter: true,
        versionRecorded: false,
        catalog: false,
      },
    });
    const { onApplied } = renderNotice({
      status: { ...AVAILABLE, versionState: "pending", storedVersion: null },
    });
    await openReview();
    fireEvent.click(screen.getByRole("button", { name: "Apply selected" }));
    await waitFor(() => expect(onApplied).toHaveBeenCalledTimes(1));
    expect(screen.getByRole("status").textContent).toContain(
      "still does not record which Starter it came from",
    );
  });

  it("lists every file it leaves alone in the review, each with why, and nowhere else", async () => {
    fns.review.mockResolvedValue({
      success: true,
      data: reviewOf({
        versionState: "pending",
        storedVersion: null,
        starter: {
          ...STARTER_PART,
          kept: [
            { path: "src/components/Header.tsx", reason: "changed" },
            { path: "src/components/sections/Hero.tsx", reason: "missing" },
            { path: "src/components/Footer.tsx", reason: "needs-missing" },
            { path: "src/morph/link.tsx", reason: "origin-unknown" },
            { path: "src/components/Principles.tsx", reason: "markers-kept" },
          ],
        },
      }),
    });
    renderNotice({
      status: { ...AVAILABLE, versionState: "pending", storedVersion: null },
    });
    const dialog = await openReview();
    const starter = within(dialog).getByRole("region", {
      name: "Starter upgrade",
    });
    const shown = (reason: string) =>
      [...starter.querySelectorAll(`[data-kept-reason="${reason}"]`)].map(
        (item) => item.textContent ?? "",
      );
    expect(shown("changed")).toEqual([
      expect.stringContaining("src/components/Header.tsx"),
    ]);
    expect(shown("changed")[0]).toContain("it is yours");
    expect(shown("missing")[0]).toContain("not added back");
    expect(shown("needs-missing")[0]).toContain(
      "needs a file you removed from this Theme",
    );
    expect(shown("origin-unknown")[0]).toContain(
      "cannot tell whether you removed it",
    );
    expect(shown("markers-kept")[0]).toContain("markers keep working");
    expect(starter.textContent).toContain("Kept as they are (5)");
    // One notice, one review: no second prompt for what is kept. The notice
    // is outside the open dialog, so it is counted by its own attribute.
    expect(
      document.querySelectorAll("[data-editor-starter-upgrade]"),
    ).toHaveLength(1);
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
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

  describe("the Starter's new pages", () => {
    const PAGES_DIGEST = "c".repeat(64);
    const HEADER = "src/components/Header.tsx";
    const ACCOUNT = "src/routes/account.tsx";
    const ORDER_TRANSFER = "src/routes/order-transfer.tsx";
    const WITH_PAGES_OFFERED = {
      ...STARTER_PART,
      kept: [
        { path: HEADER, reason: "needs-route" },
        { path: ACCOUNT, reason: "new-in-starter" },
        { path: ORDER_TRANSFER, reason: "new-in-starter" },
      ],
      optional: {
        paths: [ACCOUNT, ORDER_TRANSFER],
        pages: [
          {
            path: ACCOUNT,
            route: "/account",
            purpose: "Customer account page (/account): for the test.",
          },
          {
            path: ORDER_TRANSFER,
            route: "/order-transfer",
            purpose:
              "Order transfer confirmation page (/order-transfer): for the test.",
          },
        ],
        digest: PAGES_DIGEST,
        changes: [
          ...STARTER_PART.changes,
          {
            path: HEADER,
            operation: "update",
            before: "old header\n",
            after: 'link "/account"\n',
          },
          {
            path: ACCOUNT,
            operation: "create",
            before: null,
            after: "account page\n",
          },
          {
            path: ORDER_TRANSFER,
            operation: "create",
            before: null,
            after: "order transfer page\n",
          },
        ],
        kept: [],
      },
    };

    beforeEach(() => {
      fns.review.mockResolvedValue({
        success: true,
        data: reviewOf({ starter: WITH_PAGES_OFFERED }),
      });
    });

    const pagesBox = (dialog: HTMLElement) =>
      within(dialog).getByRole("checkbox", {
        name: "Add the Starter's new pages",
      });

    it("offers them unselected, says why, and does not claim the author removed them", async () => {
      renderNotice();
      const dialog = await openReview();
      const starter = within(dialog).getByRole("region", {
        name: "Starter upgrade",
      });
      expect(pagesBox(dialog).getAttribute("aria-checked")).toBe("false");
      const offered = [
        ...starter.querySelectorAll('[data-kept-reason="new-in-starter"]'),
      ];
      expect(offered).toHaveLength(2);
      for (const item of offered) {
        expect(item.textContent).toContain(
          "the Starter now has this page and this Theme does not",
        );
        expect(item.textContent).not.toContain("removed");
      }
      expect(offered.map((item) => item.textContent)).toEqual([
        expect.stringContaining(ACCOUNT),
        expect.stringContaining(ORDER_TRANSFER),
      ]);
      const header = starter.querySelector('[data-kept-reason="needs-route"]');
      expect(header?.textContent).toContain(HEADER);
      expect(header?.textContent).toContain(
        "links to a page this Theme does not have",
      );
      // Not in the changes until selected.
      expect(
        within(starter).queryByRole("button", { name: new RegExp(ACCOUNT) }),
      ).toBeNull();
    });

    it("applies the review without them unless the author selects them", async () => {
      const { onApplied } = renderNotice();
      await openReview();
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

    it("selected: shows them and the Header as changes, and applies that review's digest", async () => {
      const { onApplied } = renderNotice();
      const dialog = await openReview();
      fireEvent.click(pagesBox(dialog));
      const starter = within(dialog).getByRole("region", {
        name: "Starter upgrade",
      });
      for (const path of [HEADER, ACCOUNT, ORDER_TRANSFER]) {
        expect(
          within(starter).getByRole("button", { name: new RegExp(path) }),
        ).toBeTruthy();
      }
      expect(starter.querySelector("[data-kept-reason]")).toBeNull();
      fireEvent.click(
        within(starter).getByRole("button", { name: new RegExp(ACCOUNT) }),
      );
      expect(
        screen.getByLabelText(`Changes to ${ACCOUNT}`).textContent,
      ).toContain("+ account page");

      fireEvent.click(screen.getByRole("button", { name: "Apply selected" }));
      await waitFor(() => expect(onApplied).toHaveBeenCalledTimes(1));
      expect(fns.apply).toHaveBeenCalledWith({
        data: {
          storefrontId: "storefront-a",
          themeId: "theme-a",
          expectedSourceGeneration: 7,
          starterDigest: PAGES_DIGEST,
        },
      });
    });

    it("cannot be selected without the Starter upgrade itself", async () => {
      renderNotice();
      const dialog = await openReview();
      fireEvent.click(
        within(dialog).getByRole("checkbox", {
          name: "Apply the Starter upgrade",
        }),
      );
      expect((pagesBox(dialog) as HTMLButtonElement).disabled).toBe(true);
    });

    it("lists both pages with what each is for", async () => {
      renderNotice();
      const dialog = await openReview();
      const offer = dialog.querySelector("[data-starter-optional-pages]")!;
      for (const [path, purpose] of [
        [ACCOUNT, "Customer account page (/account)"],
        [ORDER_TRANSFER, "Order transfer confirmation page (/order-transfer)"],
      ]) {
        const row = offer.querySelector(`[data-starter-optional-page="${path}"]`);
        expect(row?.textContent).toContain(path);
        expect(row?.textContent).toContain(purpose);
      }
    });

    it("on the current Starter: no notice, the review opens on request, and applies only the selected pages", async () => {
      const CURRENT_STATUS = {
        versionState: "current" as const,
        storedVersion: 29,
        currentVersion: 29,
        catalogPending: null,
      };
      fns.review.mockResolvedValue({
        success: true,
        data: reviewOf({
          versionState: "current",
          storedVersion: 29,
          starter: { ...WITH_PAGES_OFFERED, changes: [] },
        }),
      });
      const onApplied = vi.fn();
      const client = new QueryClient({
        defaultOptions: { mutations: { retry: false } },
      });
      const view = (reviewRequest: number) => (
        <QueryClientProvider client={client}>
          <EditorStarterUpgradeNotice
            status={CURRENT_STATUS}
            storefrontId="storefront-a"
            themeId="theme-a"
            unsavedCount={0}
            onApplied={onApplied}
            reviewRequest={reviewRequest}
          />
        </QueryClientProvider>
      );
      const { rerender } = render(view(0));
      // Nothing reminds the author.
      expect(screen.queryByRole("status")).toBeNull();
      expect(screen.queryByRole("button", { name: "Review upgrade" })).toBeNull();
      expect(fns.review).not.toHaveBeenCalled();

      rerender(view(1));
      const dialog = await screen.findByRole("dialog", {
        name: "Review the Starter upgrade",
      });
      expect(fns.review).toHaveBeenCalledTimes(1);
      const starter = within(dialog).getByRole("region", {
        name: "Starter upgrade",
      });
      expect(
        starter.querySelectorAll('[data-kept-reason="new-in-starter"]'),
      ).toHaveLength(2);
      const applyButton = () =>
        screen.getByRole("button", { name: "Apply selected" }) as HTMLButtonElement;
      // Nothing to apply until the pages are selected.
      expect(applyButton().disabled).toBe(true);

      fireEvent.click(pagesBox(dialog));
      expect(applyButton().disabled).toBe(false);
      fireEvent.click(applyButton());
      await waitFor(() => expect(onApplied).toHaveBeenCalledTimes(1));
      expect(fns.apply).toHaveBeenCalledWith({
        data: {
          storefrontId: "storefront-a",
          themeId: "theme-a",
          expectedSourceGeneration: 7,
          starterDigest: PAGES_DIGEST,
        },
      });
    });
  });
});
