// @vitest-environment node
/**
 * What the preview may hand a Theme component that did not ask for it.
 *
 * The preview used to inject the store's name and a generated copyright into
 * every component. Two things followed. A component that never declared them
 * still received them, so anything spreading its rest props — every link in
 * the starter — put `storeName` and `copyrightText` onto a DOM element. And
 * the generated copyright reached the footer, where it outranked the one the
 * author had stored: editing that field appeared to do nothing.
 *
 * Both are the same mistake. Store identity is content, the Document owns
 * content, and the shell reads it from its own slots.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { renderSafeThemeRoute } from "@/components/storefront/safe-theme-route-renderer";
import { createDefaultStorefrontHomeDocument } from "@/lib/storefront/default-storefront-document";
import { STARTER_THEME_FILES } from "@/lib/storefront/starter-theme-files";

const files = STARTER_THEME_FILES.map((file) => ({
  path: file.path,
  content: file.content,
}));

function render(runtimeProps?: Record<string, unknown>) {
  const errors = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    const result = renderSafeThemeRoute({
      files,
      pathname: "/",
      document: createDefaultStorefrontHomeDocument(),
      runtimeProps,
    } as never);
    expect(result.success).toBe(true);
    return {
      markup: renderToStaticMarkup(result.node as never),
      warnings: errors.mock.calls.map((call) => String(call[0])),
    };
  } finally {
    errors.mockRestore();
  }
}

describe("the preview's runtime props", () => {
  it("puts nothing a component did not declare onto the DOM", () => {
    const { markup, warnings } = render();

    expect(markup).not.toContain("storeName=");
    expect(markup).not.toContain("copyrightText=");
    expect(warnings.join(" ")).not.toContain("does not recognize");
  });

  it("keeps injecting into the components that declare them", () => {
    // The narrowing must not cost the preview the thing injection is for: a
    // store that has stored no name of its own still shows its real one.
    const { markup, warnings } = render({
      storeName: "Stored test shop",
      copyrightText: "© 2026 Stored test shop",
    });

    expect(markup).toContain("Stored test shop");
    expect(markup).not.toContain("storeName=");
    expect(markup).not.toContain("copyrightText=");
    expect(warnings.join(" ")).not.toContain("does not recognize");
  });
});
