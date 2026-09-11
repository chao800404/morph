// @vitest-environment node
/**
 * A page an author built themselves, from nothing.
 *
 * The starter is a starting point, not the contract. Someone who deletes every
 * component and writes their own has to end up with the same editor: fields in
 * the panel, styles they can change, and edits that save. Nothing here is
 * registered in `morph.theme.json` — a co-located `contentFields` declaration
 * is meant to be enough on its own, and this is the test of that claim.
 *
 * These are source/renderer contracts, not browser or authenticated HTTP save
 * tests. Inspector persistence is covered separately in storefront-theme.dal.test.ts
 * and browser content/style reloads in e2e/authored-content.spec.ts.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { renderSafeThemeRoute } from "@/components/storefront/safe-theme-route-renderer";
import {
  parseComponentSource,
  patchComponentDefaultProp,
  patchElementClassNameResult,
} from "./ast/theme-ast-transformer";
import { deriveThemeRouteSections } from "./compiler/theme-route-sections";
import { filterSectionContentProps } from "./content/section-content-manifest";
import { STARTER_THEME_FILES } from "./starter-theme-files";
import { resolveThemeContentCapabilitiesFromFiles } from "./theme-content-capability-resolver";

const MY_BANNER = `import type { ThemeContentFields } from "../morph/content-fields";
import ThemeLink from "../morph/link";

export type MyBannerProps = {
  title?: string;
  blurb?: string;
  ctaLabel?: string;
  cta?: { href?: string } | string;
};

export const contentFields = {
  title: { type: "text", label: "Title", maxLength: 120 },
  blurb: { type: "textarea", label: "Blurb", maxLength: 400 },
  ctaLabel: { type: "text", label: "Button label", maxLength: 40 },
  cta: { type: "link", label: "Button destination" },
} as const satisfies ThemeContentFields;

export default function MyBanner({
  title = "Hello",
  blurb = "Something short",
  ctaLabel = "Go",
  cta = { href: "/" },
}: MyBannerProps) {
  return (
    <section className="bg-white p-10">
      <h2 className="text-4xl font-bold">{title}</h2>
      <p className="mt-4 text-base">{blurb}</p>
      <ThemeLink link={cta} className="mt-6 inline-block underline">{ctaLabel}</ThemeLink>
    </section>
  );
}`;

const MY_ROUTE = `import { createFileRoute } from "@tanstack/react-router";
import MyBanner from "../components/MyBanner";
import { content } from "../morph/content";

export const Route = createFileRoute("/")({ component: HomeRoute });

function HomeRoute() {
  return (
    <main>
      <MyBanner {...content("my-banner")} />
    </main>
  );
}`;

/** Only the contracts a Theme cannot write for itself. Every component is gone. */
const INFRASTRUCTURE = new Set([
  "src/routes/__root.tsx",
  "src/router.tsx",
  "src/morph/content.ts",
  "src/morph/content-fields.ts",
  "src/morph/link.tsx",
  "morph.theme.json",
  "package.json",
  "src/styles/global.css",
]);

const files = [
  ...STARTER_THEME_FILES.filter((file) => INFRASTRUCTURE.has(file.path)).map(
    (file) => ({ path: file.path, content: file.content }),
  ),
  {
    path: "src/layouts/StorefrontLayout.tsx",
    content: `import type { ReactNode } from "react";\n\nexport default function StorefrontLayout({ children }: { children?: ReactNode }) {\n  return <div className="min-h-screen">{children}</div>;\n}`,
  },
  { path: "src/components/MyBanner.tsx", content: MY_BANNER },
  { path: "src/routes/index.tsx", content: MY_ROUTE },
];

const SOURCE_PATH = "src/components/MyBanner.tsx";

describe("a component the author wrote, registered nowhere", () => {
  it("is found by the route as a section", () => {
    const derived = deriveThemeRouteSections(
      files as never,
      "src/routes/index.tsx",
    );

    expect(derived.diagnostics).toEqual([]);
    expect(derived.sections).toHaveLength(1);
    // With no manifest entry the source path is the identity, which is what
    // makes registering optional rather than merely undocumented.
    expect(derived.sections[0]!.componentRef).toBe(SOURCE_PATH);
  });

  it("offers its declared fields to the panel", () => {
    const { capabilities } = resolveThemeContentCapabilitiesFromFiles(
      files as never,
    );

    expect(Object.keys(capabilities[SOURCE_PATH]?.fields ?? {})).toEqual([
      "title",
      "blurb",
      "ctaLabel",
      "cta",
    ]);
  });

  it("renders stored content, and the elements the editor selects by", () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const result = renderSafeThemeRoute({
        files,
        pathname: "/",
        document: {
          version: 1,
          sections: [
            {
              id: "my-banner",
              type: "my-banner",
              componentRef: SOURCE_PATH,
              enabled: true,
              props: {
                title: "Stored title",
                cta: { href: "/collections/all" },
              },
            },
          ],
        },
      } as never);
      expect(result.success).toBe(true);
      const markup = renderToStaticMarkup(result.node as never);

      expect(markup).toContain("Stored title");
      expect(markup).toContain('href="/collections/all"');
      // Field bindings are inferred, not authored: nothing above writes one.
      expect(markup).toContain('data-storefront-field="title"');
      // And every element carries the position the style panel patches by.
      expect(markup).toContain("data-morph-loc");
      expect(errors.mock.calls).toHaveLength(0);
    } finally {
      errors.mockRestore();
    }
  });

  it("filters declared content values and excludes undeclared keys", () => {
    const { capabilities } = resolveThemeContentCapabilitiesFromFiles(
      files as never,
    );

    const kept = filterSectionContentProps(
      "my-banner",
      { title: "Edited", cta: { href: "/new" }, undeclared: "x" },
      SOURCE_PATH,
      capabilities as never,
    );

    expect(Object.keys(kept)).toEqual(["title", "cta"]);
  });

  it("allows no incoming fields when the ref names no component", () => {
    // The fail-closed boundary is unchanged by any of this: a ref this Theme
    // cannot resolve validates nothing, so nothing the client sent gets in.
    const { capabilities } = resolveThemeContentCapabilitiesFromFiles(
      files as never,
    );

    expect(
      filterSectionContentProps(
        "my-banner",
        { title: "Edited" },
        "my-banner.default",
        capabilities as never,
      ),
    ).toEqual({});
  });

  it("patches a static class using its inferred source position", () => {
    const parsed = parseComponentSource(MY_BANNER, SOURCE_PATH);
    // The preview identifies an unmarked element by its source position, which
    // is exactly what `data-morph-loc` carries back.
    const [firstElement] = Object.keys(
      (parsed as unknown as { locationMap: Record<string, unknown> })
        .locationMap,
    );

    const patched = patchElementClassNameResult(
      MY_BANNER,
      firstElement!,
      (classes) => classes.replace("bg-white", "bg-stone-100"),
    );

    expect(patched.editable).toBe(true);
    expect(patched.code).toContain("bg-stone-100");
  });

  it("patches a source default independently of stored overrides", () => {
    const patched = patchComponentDefaultProp(
      MY_BANNER,
      "title",
      "New default",
    );

    expect(patched).toContain('title = "New default"');
  });
});
