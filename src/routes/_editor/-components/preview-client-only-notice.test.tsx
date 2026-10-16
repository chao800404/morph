import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ThemeClientOnlyPreviewLimit } from "@/lib/storefront/compiler/theme-client-only-preview-limits";
import {
  PreviewClientOnlyNotice,
  previewClientOnlyNoticeLimits,
} from "./preview-client-only-notice";

const LIMITS: ThemeClientOnlyPreviewLimit[] = [
  { file: "src/routes/index.tsx", line: 7, kind: "createServerFn" },
  { file: "src/routes/index.tsx", line: 3, kind: "server-route" },
  { file: "src/lib/cookie.ts", line: 1, kind: "server-api", names: ["getCookie"] },
];

describe("which start answers get the client-only notice", () => {
  it("a client-only start with uses", () => {
    expect(
      previewClientOnlyNoticeLimits({
        success: true,
        data: { previewRuntime: "client", clientOnlyLimits: LIMITS },
      }),
    ).toBe(LIMITS);
  });

  it.each([
    ["the full Start preview", { success: true as const, data: { previewRuntime: "start" as const, clientOnlyLimits: LIMITS } }],
    ["a client-only start with no uses", { success: true as const, data: { previewRuntime: "client" as const, clientOnlyLimits: [] } }],
    ["a start that does not name its runtime", { success: true as const, data: { clientOnlyLimits: LIMITS } }],
    ["a failed start", { success: false as const }],
    ["no answer yet", undefined],
  ])("not %s", (_name, result) => {
    expect(previewClientOnlyNoticeLimits(result)).toEqual([]);
  });
});

describe("the client-only notice", () => {
  it("names each file once, with what it uses, and opens it at its first use", () => {
    const onOpenFile = vi.fn();
    render(<PreviewClientOnlyNotice limits={LIMITS} onOpenFile={onOpenFile} />);

    const notice = screen.getByRole("status");
    expect(notice.textContent).toContain(
      "This Live Preview runs in the browser only",
    );
    expect(notice.textContent).toContain("MORPH_THEME_PREVIEW_RUNTIME=start");
    expect(notice.textContent).toContain("(server function, server route)");
    expect(notice.textContent).toContain("(server API)");
    expect(screen.getAllByRole("button", { name: "src/routes/index.tsx" })).toHaveLength(1);

    fireEvent.click(screen.getByRole("button", { name: "src/routes/index.tsx" }));
    expect(onOpenFile).toHaveBeenCalledWith("src/routes/index.tsx", 3);
  });

  it("is not an alert, and the author can dismiss it", () => {
    render(<PreviewClientOnlyNotice limits={LIMITS} onOpenFile={vi.fn()} />);
    expect(screen.queryByRole("alert")).toBeNull();
    fireEvent.click(
      screen.getByRole("button", {
        name: "Dismiss the client-only preview notice",
      }),
    );
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("renders nothing with no limits", () => {
    const { container } = render(
      <PreviewClientOnlyNotice limits={[]} onOpenFile={vi.fn()} />,
    );
    expect(container.innerHTML).toBe("");
  });
});
