import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ThemeClientOnlyPreviewLimit } from "@/lib/storefront/compiler/theme-client-only-preview-limits";
import {
  PreviewClientOnlyNotice,
  type PreviewClientOnlyNoticeContent,
  previewClientOnlyNoticeContent,
} from "./preview-client-only-notice";

const LIMITS: ThemeClientOnlyPreviewLimit[] = [
  { file: "src/routes/index.tsx", line: 7, kind: "createServerFn" },
  { file: "src/routes/index.tsx", line: 3, kind: "server-route" },
  { file: "src/lib/cookie.ts", line: 1, kind: "server-api", names: ["getCookie"] },
];

const client = (data: Record<string, unknown>) => ({
  success: true as const,
  data: { previewRuntime: "client" as const, ...data },
});

describe("which start answers get the client-only notice", () => {
  it("a client-only start with uses", () => {
    expect(
      previewClientOnlyNoticeContent(
        client({
          clientOnlyLimits: LIMITS,
          clientOnlyLimitsOmitted: 4,
          clientOnlyLimitsIncomplete: false,
        }),
      ),
    ).toEqual({ limits: LIMITS, omitted: 4, incomplete: false });
  });

  it("a client-only start that could not check everything, even with no uses", () => {
    expect(
      previewClientOnlyNoticeContent(
        client({ clientOnlyLimits: [], clientOnlyLimitsIncomplete: true }),
      ),
    ).toEqual({ limits: [], omitted: 0, incomplete: true });
  });

  it.each([
    ["the full Start preview", { success: true as const, data: { previewRuntime: "start" as const, clientOnlyLimits: LIMITS } }],
    ["a client-only start with no uses, fully checked", client({ clientOnlyLimits: [], clientOnlyLimitsIncomplete: false })],
    ["a start that does not name its runtime", { success: true as const, data: { clientOnlyLimits: LIMITS, clientOnlyLimitsIncomplete: true } }],
    ["an Astro start, which carries no runtime fields", { success: true as const, data: {} }],
    ["a failed start", { success: false as const }],
    ["no answer yet", undefined],
  ])("not %s", (_name, result) => {
    expect(previewClientOnlyNoticeContent(result)).toBeNull();
  });
});

const content = (
  overrides: Partial<PreviewClientOnlyNoticeContent> = {},
): PreviewClientOnlyNoticeContent => ({
  limits: LIMITS,
  omitted: 0,
  incomplete: false,
  ...overrides,
});
const card = () =>
  document.querySelector('[data-slot="preview-client-only-notice"]');

describe("the client-only notice", () => {
  it("names each file once, with what it uses, and opens it at its first use", () => {
    const onOpenFile = vi.fn();
    render(
      <PreviewClientOnlyNotice content={content()} startKey={1} onOpenFile={onOpenFile} />,
    );

    const text = card()?.textContent ?? "";
    expect(text).toContain(
      "This preview runs in client-only mode, so the server functions and server APIs below do not run here",
    );
    expect(text).toContain(
      "A full Start preview is a deployment-level setting that is not enabled for this preview.",
    );
    expect(text).toContain("The list reflects the Theme as of when this preview started.");
    // Authors cannot act on the deployment variable; it is not shown to them.
    expect(text).not.toContain("MORPH_THEME_PREVIEW_RUNTIME");
    expect(text).toContain("(server function, server route)");
    expect(text).toContain("(server API)");
    expect(text).not.toContain("more not listed");
    expect(text).not.toContain("may be incomplete");
    expect(screen.getAllByRole("button", { name: "src/routes/index.tsx" })).toHaveLength(1);

    fireEvent.click(screen.getByRole("button", { name: "src/routes/index.tsx" }));
    expect(onOpenFile).toHaveBeenCalledWith("src/routes/index.tsx", 3);
  });

  it("says how many more were found than listed", () => {
    render(
      <PreviewClientOnlyNotice content={content({ omitted: 7 })} startKey={1} onOpenFile={vi.fn()} />,
    );
    expect(card()?.textContent).toContain("and 7 more not listed.");
  });

  it("says the list may be incomplete when a file could not be checked", () => {
    render(
      <PreviewClientOnlyNotice content={content({ incomplete: true })} startKey={1} onOpenFile={vi.fn()} />,
    );
    expect(card()?.textContent).toContain(
      "Some files could not be checked, so this list may be incomplete.",
    );
  });

  it("says the check could not be completed when it found nothing it could trust", () => {
    render(
      <PreviewClientOnlyNotice
        content={content({ limits: [], incomplete: true })}
        startKey={1}
        onOpenFile={vi.fn()}
      />,
    );
    const text = card()?.textContent ?? "";
    expect(text).toContain("Some Theme files could not be checked");
    expect(text).toContain("This check reflects the Theme as of when this preview started.");
    expect(screen.queryAllByRole("button", { name: /^src\// })).toHaveLength(0);
  });

  it("is rendered into a live region that was mounted before it", () => {
    const { rerender } = render(
      <PreviewClientOnlyNotice content={null} startKey={1} onOpenFile={vi.fn()} />,
    );
    const region = screen.getByRole("status");
    expect(region.getAttribute("aria-live")).toBe("polite");
    expect(region.textContent).toBe("");
    rerender(
      <PreviewClientOnlyNotice content={content()} startKey={2} onOpenFile={vi.fn()} />,
    );
    // The same element, now holding the notice: announced as it appears.
    expect(screen.getByRole("status")).toBe(region);
    expect(region.contains(card())).toBe(true);
    // Not a second live region, and not an alert.
    expect(card()?.getAttribute("role")).toBe("group");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("the author can dismiss it, and a new start brings it back", () => {
    const { rerender } = render(
      <PreviewClientOnlyNotice content={content()} startKey={1} onOpenFile={vi.fn()} />,
    );
    act(() => {
      fireEvent.click(
        screen.getByRole("button", { name: "Dismiss the client-only preview notice" }),
      );
    });
    expect(card()).toBeNull();
    rerender(
      <PreviewClientOnlyNotice content={content()} startKey={2} onOpenFile={vi.fn()} />,
    );
    expect(card()).not.toBeNull();
  });

  it("renders only the empty region with nothing to say", () => {
    render(<PreviewClientOnlyNotice content={null} startKey={1} onOpenFile={vi.fn()} />);
    expect(card()).toBeNull();
    expect(screen.getByRole("status").textContent).toBe("");
  });
});
