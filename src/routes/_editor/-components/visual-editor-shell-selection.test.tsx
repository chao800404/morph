import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { StorefrontThemeEditorDTO } from "@/lib/storefront/dto/storefront-theme.dto";
import type { StorefrontThemeEditorSearch } from "@/lib/validations/storefront-theme";
import { postEditorToPreviewMessage } from "@/lib/storefront/editor/preview-protocol";
import { VisualEditorShell } from "./visual-editor-shell";

/**
 * The first test that renders `VisualEditorShell` itself.
 *
 * Until now nothing did. The file is the largest in the editor and its own
 * test file never named the component — the protection it had in CI was a
 * handful of assertions about two presentational surfaces and three exported
 * pure functions, while the editor end-to-end suite is skipped there for want
 * of credentials.
 *
 * So this is a seam before it is a test. Extracting the selection and reveal
 * controller out of the shell is the change that matters, and there was
 * nowhere to observe the shell's behaviour from while doing it. There is now.
 *
 * What it covers: that the shell mounts against a minimal editor context and
 * renders its chrome, and that it says nothing to a preview that does not
 * exist yet. What it does not cover: the selection round trip. That needs a
 * fixture where the preview is ready and the tree holds sections, which is the
 * next piece of this harness rather than something to fake here.
 */

// The shell posts through this. Mocked rather than driven through a real
// iframe because `postEditorToPreviewMessage` deliberately refuses to post to a
// frame that is still same-origin, which is every iframe jsdom can make — the
// transport would swallow the very messages this is here to watch.
vi.mock("@/lib/storefront/editor/preview-protocol", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  postEditorToPreviewMessage: vi.fn(),
}));

// The shell uses `Link` for its breadcrumb and back control. Standing up a
// real router to satisfy two anchors would make this a test about routing.
vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  Link: ({
    to,
    children,
    ...rest
  }: {
    to?: string;
    children?: React.ReactNode;
  }) => (
    <a href={to} {...rest}>
      {children}
    </a>
  ),
}));

const context = {
  storefront: { id: "storefront-1", name: "Store", domain: null },
  theme: { id: "theme-1", name: "Theme", sourceGeneration: 1 },
  templates: [
    {
      id: "template-1",
      type: "index",
      name: "Home",
      document: { version: 1, sections: [] },
      draftGeneration: 1,
      version: 1,
    },
  ],
} as unknown as StorefrontThemeEditorDTO;

const search = {
  template: "index",
  templateId: "template-1",
  viewport: "desktop",
} as StorefrontThemeEditorSearch;

function renderShell() {
  return render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <VisualEditorShell
        context={context}
        search={search}
        onSearchChange={vi.fn()}
      />
    </QueryClientProvider>,
  );
}

describe("VisualEditorShell", () => {
  it("mounts against a minimal editor context", () => {
    renderShell();

    // Its own chrome, rather than a snapshot: the point is that the component
    // reaches the end of a render with a context that declares almost nothing.
    expect(
      document.querySelectorAll("[data-editor-mode-surface]").length,
    ).toBeGreaterThan(0);
    expect(screen.getAllByRole("button").length).toBeGreaterThan(0);
  });

  /**
   * Nothing is addressed to a preview that has not been created.
   *
   * Posting before there is a frame is not harmless: a message sent to an
   * iframe still sitting on `about:blank` is refused for the wrong origin and
   * is gone, with a console warning as its only trace — which is how editor
   * state went missing five times on every preview load before the transport
   * learned to hold back.
   */
  it("sends nothing to a preview it has not started", () => {
    renderShell();

    expect(vi.mocked(postEditorToPreviewMessage)).not.toHaveBeenCalled();
  });
});
