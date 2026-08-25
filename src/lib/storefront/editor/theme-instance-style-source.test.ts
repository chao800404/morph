import { describe, expect, it } from "vitest";
import { BrowserPreviewThemeCompiler } from "../compiler/browser-preview-compiler";
import {
  canPatchThemeInstanceStyleClasses,
  findLegacyThemeInstanceStyleSheet,
  isRepeatedFieldPath,
  patchThemeInstanceStyleClasses,
  readLegacyThemeInstanceStyleClasses,
  readThemeElementBaseClasses,
  readThemeInstanceStyleClasses,
  removeLegacyThemeInstanceStyle,
  removeLegacyThemeInstanceStyleImport,
} from "./theme-instance-style-source";

const target = {
  sectionId: "principles-1",
  fieldPath: "items.1.title",
  itemId: "principle-thoughtful-sourcing",
};

const source = [
  'import { clsx as cn } from "clsx";',
  "",
  "type PrincipleItem = { title?: string };",
  "",
  "export default function Principles({ items = [] }: { items?: PrincipleItem[] }) {",
  "  return (",
  "    <>{items.map((item) => (",
  '      <h3 data-morph-node="principle-title" className={cn("mt-12 font-serif text-3xl text-stone-950")}>{item.title}</h3>',
  "    ))}</>",
  "  );",
  "}",
].join("\n");

describe("theme instance style source", () => {
  it("recognizes array-backed field paths only", () => {
    expect(isRepeatedFieldPath("items.1.title")).toBe(true);
    expect(isRepeatedFieldPath("heading")).toBe(false);
    expect(isRepeatedFieldPath(null)).toBe(false);
  });

  it("writes, reads, replaces, and removes a scoped TSX cn() override", () => {
    const first = patchThemeInstanceStyleClasses(
      source,
      target,
      "principle-title",
      () => "mt-12 font-serif text-4xl text-blue-500 lg:text-[54px]",
    );
    expect(first.editable).toBe(true);
    expect(first.code).toContain(
      'className={morphInstanceClasses[`${item.id}:principle-title`] ?? "mt-12 font-serif text-3xl text-stone-950"}',
    );
    expect(first.code).toContain(
      '"principle-thoughtful-sourcing:principle-title": "mt-12 font-serif text-4xl text-blue-500 lg:text-[54px]"',
    );
    expect(first.code).toContain(
      "morphInstanceClasses[\`\${item.id}:principle-title\`]",
    );
    expect(first.code).not.toContain("[[data-storefront-section-id=");
    expect(
      readThemeInstanceStyleClasses(first.code, target, "principle-title"),
    ).toBe("mt-12 font-serif text-4xl text-blue-500 lg:text-[54px]");
    expect(readThemeElementBaseClasses(first.code, "principle-title")).toBe(
      "mt-12 font-serif text-3xl text-stone-950",
    );

    const second = patchThemeInstanceStyleClasses(
      first.code,
      target,
      "principle-title",
      () => "font-serif text-5xl text-red-500",
    );
    expect(
      readThemeInstanceStyleClasses(second.code, target, "principle-title"),
    ).toBe("font-serif text-5xl text-red-500");

    const removed = patchThemeInstanceStyleClasses(
      second.code,
      target,
      "principle-title",
      () => "",
    );
    expect(
      readThemeInstanceStyleClasses(removed.code, target, "principle-title"),
    ).toBeNull();
    expect(readThemeElementBaseClasses(removed.code, "principle-title")).toBe(
      "mt-12 font-serif text-3xl text-stone-950",
    );
  });

  it("converts a static className to cn() and adds one import", () => {
    const plain = [
      "type CardItem = { title?: string };",
      "export default function Cards({ items = [] }: { items?: CardItem[] }) {",
      "  return <>{items.map((entry) => (",
      '    <article data-morph-node="card" className="p-4 text-sm">{entry.title}</article>',
      "  ))}</>;",
      "}",
    ].join("\n");
    const result = patchThemeInstanceStyleClasses(
      plain,
      {
        sectionId: "section-1",
        fieldPath: "items.0",
        itemId: "card-primary",
      },
      "card",
      () => "p-8 text-lg",
    );
    expect(result.editable).toBe(true);
    expect(result.code).toContain(
      'className={morphInstanceClasses[`${entry.id}:card`] ?? "p-4 text-sm"}',
    );
    expect(result.code).toContain("id?: string;");
  });

  it("preserves separate overrides for multiple array instances", () => {
    const first = patchThemeInstanceStyleClasses(
      source,
      target,
      "principle-title",
      () => "text-4xl",
    );
    const secondTarget = {
      sectionId: "principles-1",
      fieldPath: "items.2.title",
      itemId: "principle-everyday-usefulness",
    };
    const second = patchThemeInstanceStyleClasses(
      first.code,
      secondTarget,
      "principle-title",
      () => "text-6xl",
    );
    expect(
      readThemeInstanceStyleClasses(second.code, target, "principle-title"),
    ).toBe("text-4xl");
    expect(
      readThemeInstanceStyleClasses(
        second.code,
        secondTarget,
        "principle-title",
      ),
    ).toBe("text-6xl");
  });

  it("treats the scoped class snapshot as authoritative so removed base utilities do not remain active", () => {
    const cardSource = [
      "type CardItem = { id?: string; title?: string };",
      "export default function Cards({ items = [] }: { items?: CardItem[] }) {",
      "  return <>{items.map((item) => (",
      '    <article data-morph-node="card" className="py-8 lg:px-8 lg:first:pl-0">{item.title}</article>',
      "  ))}</>;",
      "}",
    ].join("\n");
    const result = patchThemeInstanceStyleClasses(
      cardSource,
      {
        sectionId: "section-1",
        fieldPath: "items.0.title",
        itemId: "card-first",
      },
      "card",
      () => "lg:p-[28px]",
    );

    expect(result.editable).toBe(true);
    expect(result.code).toContain(
      '"card-first:card": "lg:p-[28px]"',
    );
    expect(result.code).toContain(
      'className={morphInstanceClasses[`${item.id}:card`] ?? "py-8 lg:px-8 lg:first:pl-0"}',
    );
    expect(
      readThemeInstanceStyleClasses(
        result.code,
        {
          sectionId: "section-1",
          fieldPath: "items.0.title",
          itemId: "card-first",
        },
        "card",
      ),
    ).toBe("lg:p-[28px]");
    expect(readThemeElementBaseClasses(result.code, "card")).toBe(
      "py-8 lg:px-8 lg:first:pl-0",
    );
  });

  it("migrates an existing additive instance lookup to authoritative fallback semantics on the next edit", () => {
    const existingSource = [
      'import { clsx as cn } from "clsx";',
      'const morphInstanceClasses: Record<string, string> = { "card-first:card": "lg:px-8" };',
      "type CardItem = { id?: string; title?: string };",
      "export default function Cards({ items = [] }: { items?: CardItem[] }) {",
      "  return <>{items.map((item) => (",
      '    <article data-morph-node="card" className={cn("py-8 lg:px-8", morphInstanceClasses[`${item.id}:card`])}>{item.title}</article>',
      "  ))}</>;",
      "}",
    ].join("\n");
    const result = patchThemeInstanceStyleClasses(
      existingSource,
      {
        sectionId: "section-1",
        fieldPath: "items.0.title",
        itemId: "card-first",
      },
      "card",
      () => "lg:p-[28px]",
    );

    expect(result.editable).toBe(true);
    expect(result.code).toContain(
      'className={morphInstanceClasses[`${item.id}:card`] ?? "py-8 lg:px-8"}',
    );
    expect(result.code).toContain(
      '"card-first:card": "lg:p-[28px]"',
    );
  });

  it("rejects unsupported dynamic className expressions", () => {
    const dynamic = [
      "export default function Card({ className }) {",
      '  return <article data-morph-node="card" className={className} />;',
      "}",
    ].join("\n");
    expect(
      canPatchThemeInstanceStyleClasses(dynamic, "card", {
        sectionId: "section-1",
        fieldPath: "items.0",
        itemId: "card-primary",
      }),
    ).toBe(false);
    expect(
      patchThemeInstanceStyleClasses(
        dynamic,
        {
          sectionId: "section-1",
          fieldPath: "items.0",
          itemId: "card-primary",
        },
        "card",
        () => "p-8",
      ),
    ).toMatchObject({ editable: false, reason: "dynamic-classname" });
  });

  it("rejects cn() expressions that contain component logic", () => {
    const dynamic = [
      "export default function Card({ selected }) {",
      '  return <article data-morph-node="card" className={cn("p-4", selected && "ring-2")} />;',
      "}",
    ].join("\n");

    expect(
      canPatchThemeInstanceStyleClasses(dynamic, "card", {
        sectionId: "section-1",
        fieldPath: "items.0",
        itemId: "card-primary",
      }),
    ).toBe(false);
    expect(
      patchThemeInstanceStyleClasses(
        dynamic,
        {
          sectionId: "section-1",
          fieldPath: "items.0",
          itemId: "card-primary",
        },
        "card",
        () => "p-8",
      ),
    ).toMatchObject({ editable: false, reason: "dynamic-classname" });
  });

  it("reads and removes a legacy CSS rule only as migration input", () => {
    const legacy = [
      "/* morph-instance-style:principles-1:items.1.title */",
      '[data-storefront-section-id="principles-1"] [data-storefront-field-path="items.1.title"] {',
      "  @apply text-4xl text-red-500;",
      "}",
      "/* /morph-instance-style:principles-1:items.1.title */",
      "",
    ].join("\n");
    expect(readLegacyThemeInstanceStyleClasses(legacy, target)).toBe(
      "text-4xl text-red-500",
    );
    expect(removeLegacyThemeInstanceStyle(legacy, target)).toBe("");
    expect(
      findLegacyThemeInstanceStyleSheet(
        [
          { path: "src/styles/global.css", content: legacy },
          { path: "src/components/Principles.morph.css", content: "" },
        ],
        "src/components/Principles.tsx",
        target,
      )?.path,
    ).toBe("src/styles/global.css");
  });

  it("removes only the matching empty adjacent legacy stylesheet import", () => {
    const globalCss = [
      '@import "tailwindcss";',
      '@import "../components/Principles.morph.css";',
      '@import "../components/Hero.css";',
      "",
    ].join("\n");
    expect(
      removeLegacyThemeInstanceStyleImport(
        globalCss,
        "src/components/Principles.morph.css",
      ),
    ).toBe('@import "tailwindcss";\n@import "../components/Hero.css";\n');
  });

  it("produces static Tailwind v4 variants accepted by the preview compiler", async () => {
    const patched = patchThemeInstanceStyleClasses(
      source,
      target,
      "principle-title",
      () => "border-b lg:border-b-0 lg:border-r lg:px-8",
    );
    expect(patched.editable).toBe(true);

    const result = await new BrowserPreviewThemeCompiler().compile({
      files: [
        {
          path: "src/styles/global.css",
          content: '@import "tailwindcss";',
        },
        {
          path: "src/components/Principles.tsx",
          content: patched.code,
        },
      ],
    });

    expect(result.success).toBe(true);
    expect(result.css).not.toContain("data-storefront-section-id");
    expect(result.css).toContain("border-right-style");
    expect(result.css).toContain("@media (width >= 64rem)");
  });
});
