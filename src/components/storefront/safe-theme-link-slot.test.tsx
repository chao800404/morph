// @vitest-environment node
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { renderSafeThemeComponent } from "./safe-theme-component-renderer";
import { resolveThemeLinksInSlotValues } from "@/lib/storefront/theme-link";

/**
 * What a Theme author writes for a `type: "link"` field.
 *
 * `rel` is read off the value rather than assembled in the component: Themes
 * cannot import Morph code, so leaving `rel` to the author would make an
 * unprotected new tab a one-line omission away.
 */
const heroSource = `export const contentFields = {
  action: { type: "link", label: "Action" },
} as const;

export default function Hero({ action = {}, actionLabel = "Shop" }) {
  return (
    <a
      href={action.href}
      target={action.target}
      rel={action.rel}
      title={action.title}
      download={action.download}
    >
      {actionLabel}
    </a>
  );
}`;

function renderHero(action: unknown) {
  // Mirrors what the route renderer and the published content response do
  // before a component ever sees a slot's values.
  const props = resolveThemeLinksInSlotValues({ action });
  const result = renderSafeThemeComponent({
    files: [{ path: "src/components/Hero.tsx", content: heroSource }],
    sourcePath: "src/components/Hero.tsx",
    componentName: "Hero",
    props,
  } as never);
  expect(result.success, result.success ? "" : result.diagnostics.join("; ")).toBe(
    true,
  );
  if (!result.success) throw new Error("render failed");
  return renderToStaticMarkup(result.node as never);
}

describe("a link content field reaching a component", () => {
  it("renders an in-store destination with nothing extra", () => {
    const html = renderHero({ href: "/collections/all" });
    expect(html).toContain('href="/collections/all"');
    expect(html).not.toContain("target=");
    expect(html).not.toContain("rel=");
  });

  it("protects a cross-origin new tab without the author asking", () => {
    const html = renderHero({ href: "https://example.com", target: "_blank" });
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
  });

  it("carries nofollow alongside that protection", () => {
    const html = renderHero({
      href: "https://example.com",
      target: "_blank",
      nofollow: true,
    });
    expect(html).toContain('rel="noopener noreferrer nofollow"');
  });

  it("renders the advisory title", () => {
    const html = renderHero({ href: "/a", title: "Our lookbook" });
    expect(html).toContain('title="Our lookbook"');
  });

  it("marks an in-store file as a download", () => {
    const html = renderHero({ href: "/lookbook.pdf", download: true });
    expect(html).toContain("download");
  });

  it("drops download for another origin, which browsers ignore anyway", () => {
    const html = renderHero({ href: "https://example.com/a.pdf", download: true });
    expect(html).not.toContain("download");
  });

  it("leaves an inert anchor for a script destination", () => {
    const html = renderHero({ href: "javascript:alert(1)" });
    expect(html).not.toContain("javascript:");
    expect(html).not.toContain("href=");
  });

  it("leaves a bare string unresolved, because a link is told apart by shape", () => {
    // Slot values carry no field types, so links are recognised by their shape.
    // Promoting every string would turn ordinary text into a link, so a value
    // stored before the field became a link stays a string and renders inert.
    // Editing the field in the Inspector writes the object form.
    const html = renderHero("/about");
    expect(html).not.toContain('href="/about"');
  });
});
