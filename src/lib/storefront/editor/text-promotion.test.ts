// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  analyzeTextPromotion,
  describeTextPromotionRefusal,
  renderedJsxText,
  type TextPromotionRefusal,
} from "./text-promotion";

const CONTENT = {
  path: "src/morph/content.ts",
  content: "export function content(slot: string) { return {}; }\n",
};
const SECTION = "src/components/sections/Promo.tsx";

function route(element = `<Promo {...content("promo")} />`) {
  return {
    path: "src/routes/index.tsx",
    content: `import { createFileRoute } from "@tanstack/react-router";
import { content } from "../morph/content";
import Promo from "../components/sections/Promo";

export const Route = createFileRoute("/")({ component: Home });

function Home() {
  return (
    <main>
      ${element}
    </main>
  );
}
`,
  };
}

function analyze(
  component: string,
  options: {
    path?: string;
    targetKey?: string;
    routeElement?: string;
    extraFiles?: { path: string; content: string }[];
    routeSourcePath?: string | null;
  } = {},
) {
  const path = options.path ?? SECTION;
  const files = [
    CONTENT,
    { path, content: component },
    route(
      options.routeElement ??
        `<Promo {...content("promo")} />`.replace(
          "../components/sections/Promo",
          path,
        ),
    ),
    ...(options.extraFiles ?? []),
  ];
  if (path !== SECTION) {
    files[2] = {
      ...files[2]!,
      content: files[2]!.content.replace(
        "../components/sections/Promo",
        `../${path.replace(/^src\//, "").replace(/\.tsx$/, "")}`,
      ),
    };
  }
  return analyzeTextPromotion({
    files,
    componentSourcePath: path,
    targetKey: options.targetKey ?? "3:5",
    slotId: "promo",
    routeSourcePath:
      options.routeSourcePath === undefined
        ? "src/routes/index.tsx"
        : options.routeSourcePath,
  });
}

function refusal(
  result: ReturnType<typeof analyze>,
): TextPromotionRefusal | null {
  return result.status === "code-only" ? result.reason : null;
}

describe("analyzeTextPromotion — convertible", () => {
  it("offers plain text in a section whose fields are inferred", () => {
    const result = analyze(`export default function Promo({ eyebrow = "New" }) {
  return (
    <p className="lead">hello world</p>
  );
}
`);
    expect(result).toEqual({
      status: "convertible",
      text: "hello world",
      tag: "p",
      suggestedName: "text",
      reservedNames: ["eyebrow"],
      fieldDeclaration: "inferred",
      callSite: { path: "src/routes/index.tsx", scope: "route" },
    });
  });

  it("reads the text as it renders: JSX whitespace, entities decoded", () => {
    const result = analyze(`export default function Promo({}) {
  return (
    <h2>
      Quiet essentials &amp;
      everyday rituals
    </h2>
  );
}
`);
    expect(result).toMatchObject({
      status: "convertible",
      text: "Quiet essentials & everyday rituals",
      suggestedName: "heading",
    });
  });

  it("finds the element by its data-morph-node as well as by position", () => {
    const result = analyze(
      `export default function Promo({}) {
  return <div><span data-morph-node="badge">Sale</span></div>;
}
`,
      { targetKey: "badge" },
    );
    expect(result).toMatchObject({ status: "convertible", text: "Sale" });
  });

  it("adds to a colocated declaration outside the section folders", () => {
    const result = analyze(
      `export const contentFields = {
  text: { type: "text" },
} as const;

export default function Banner({ text = "x" }: { text?: string; tone?: string }) {
  return <p>Fixed line</p>;
}
`,
      { path: "src/components/Banner.tsx", targetKey: "6:10" },
    );
    expect(result).toMatchObject({
      status: "convertible",
      fieldDeclaration: "colocated",
      suggestedName: "text2",
      reservedNames: ["text", "tone"],
    });
  });

  it("does not suggest a name the page passes after the section's content", () => {
    const result = analyze(
      `export default function Promo({}) {
  return (
    <p>hello</p>
  );
}
`,
      { routeElement: `<Promo {...content("promo")} text="pinned" />` },
    );
    expect(result).toMatchObject({
      status: "convertible",
      suggestedName: "text2",
      reservedNames: ["text"],
    });
  });

  it("finds a section the layout renders, as layout scope", () => {
    const result = analyzeTextPromotion({
      files: [
        CONTENT,
        {
          path: "src/routes/__root.tsx",
          content: `import { Outlet } from "@tanstack/react-router";
import Shell from "../layouts/Shell";
export default function Root() {
  return <Shell><Outlet /></Shell>;
}
`,
        },
        {
          path: "src/layouts/Shell.tsx",
          content: `import { content } from "../morph/content";
import Header from "../components/sections/Header";
export default function Shell({ children }) {
  return <><Header {...content("site-header")} />{children}</>;
}
`,
        },
        {
          path: "src/components/sections/Header.tsx",
          content: `export default function Header({}) {
  return (
    <span>Free shipping over $50</span>
  );
}
`,
        },
      ],
      componentSourcePath: "src/components/sections/Header.tsx",
      targetKey: "3:5",
      slotId: "site-header",
      routeSourcePath: null,
    });
    expect(result).toMatchObject({
      status: "convertible",
      suggestedName: "label",
      callSite: { path: "src/layouts/Shell.tsx", scope: "layout" },
    });
  });

  it("accepts a props type this file defines", () => {
    const result = analyze(
      `type PromoProps = { eyebrow?: string };
export default function Promo({ eyebrow }: PromoProps) {
  return <p>hello</p>;
}
`,
      { targetKey: "3:10" },
    );
    expect(result).toMatchObject({
      status: "convertible",
      reservedNames: ["eyebrow"],
    });
  });
});

describe("analyzeTextPromotion — code-only", () => {
  it("refuses markup or expressions inside the text", () => {
    expect(
      refusal(
        analyze(`export default function Promo({}) {
  return (
    <p>Hello <strong>world</strong></p>
  );
}
`),
      ),
    ).toBe("not-plain-text");
    expect(
      refusal(
        analyze(`export default function Promo({ title }) {
  return (
    <p>{title}</p>
  );
}
`),
      ),
    ).toBe("not-plain-text");
  });

  it("refuses an element rendered once per list item", () => {
    expect(
      refusal(
        analyze(
          `export default function Promo({ items = [] }) {
  return <ul>{items.map((item) => <li key={item}>Fixed</li>)}</ul>;
}
`,
          { targetKey: "2:35" },
        ),
      ),
    ).toBe("inside-loop");
  });

  it("refuses an element rendered by a condition", () => {
    expect(
      refusal(
        analyze(
          `export default function Promo({ open = false }) {
  return <div>{open && <p>Only when open</p>}</div>;
}
`,
          { targetKey: "2:24" },
        ),
      ),
    ).toBe("inside-expression");
  });

  it("refuses props that are not destructured, or collected into a rest", () => {
    expect(
      refusal(
        analyze(`export default function Promo(props) {
  return (
    <p>hello</p>
  );
}
`),
      ),
    ).toBe("props-not-destructured");
    expect(
      refusal(
        analyze(`export default function Promo({ ...rest }) {
  return (
    <p>hello</p>
  );
}
`),
      ),
    ).toBe("props-not-destructured");
  });

  it("refuses props typed in another file", () => {
    expect(
      refusal(
        analyze(
          `import type { PromoProps } from "./types";
export default function Promo({ eyebrow }: PromoProps) {
  return <p>hello</p>;
}
`,
          { targetKey: "3:10" },
        ),
      ),
    ).toBe("props-type-elsewhere");
  });

  it("refuses a component with no fields of its own and none inferable", () => {
    expect(
      refusal(
        analyze(
          `export default function Other({}) {
  return (
    <p>hello</p>
  );
}
`,
          { path: "src/components/Other.tsx" },
        ),
      ),
    ).toBe("no-field-capability");
  });

  it("refuses text outside the default-exported component", () => {
    expect(
      refusal(
        analyze(`function Helper() {
  return (
    <p>hello</p>
  );
}
export default function Promo({}) { return <Helper />; }
`),
      ),
    ).toBe("not-in-default-component");
  });

  it("refuses text written in a component the section renders", () => {
    const result = analyzeTextPromotion({
      files: [
        CONTENT,
        route(),
        {
          path: SECTION,
          content: `import Badge from "../Badge";
export default function Promo({}) { return <Badge />; }
`,
        },
        {
          path: "src/components/Badge.tsx",
          content: `export default function Badge({}) {
  return (
    <span>New</span>
  );
}
`,
        },
      ],
      componentSourcePath: "src/components/Badge.tsx",
      sectionSourcePath: SECTION,
      targetKey: "3:5",
      slotId: "promo",
      routeSourcePath: "src/routes/index.tsx",
    });
    expect(result).toEqual({
      status: "code-only",
      reason: "in-nested-component",
      text: "New",
    });
  });

  it("refuses when no page hands the section its content", () => {
    expect(
      refusal(
        analyze(
          `export default function Promo({}) {
  return (
    <p>hello</p>
  );
}
`,
          { routeElement: `<Promo />` },
        ),
      ),
    ).toBe("call-site-not-found");
  });

  it("refuses when the page spreads something after the section's content", () => {
    expect(
      refusal(
        analyze(
          `export default function Promo({}) {
  return (
    <p>hello</p>
  );
}
`,
          { routeElement: `<Promo {...content("promo")} {...overrides} />` },
        ),
      ),
    ).toBe("call-site-opaque");
  });

  it("reports an element it cannot find, or source it cannot read", () => {
    expect(
      refusal(
        analyze(`export default function Promo({}) { return <p>hi</p>; }\n`, {
          targetKey: "99:1",
        }),
      ),
    ).toBe("not-found");
    expect(refusal(analyze(`export default function (`))).toBe("parse-error");
  });

  it("keeps the text it read when it refuses, for the Inspector to show", () => {
    expect(
      analyze(`export default function Promo(props) {
  return (
    <p>hello</p>
  );
}
`),
    ).toEqual({
      status: "code-only",
      reason: "props-not-destructured",
      text: "hello",
    });
  });
});

describe("renderedJsxText", () => {
  it("keeps a single line as written, and collapses line breaks", () => {
    expect(renderedJsxText("  hello  ")).toBe("  hello  ");
    expect(renderedJsxText("\n    one\n    two\n  ")).toBe("one two");
    expect(renderedJsxText("\n   \n")).toBe("");
  });
});

describe("describeTextPromotionRefusal", () => {
  it("has a reason for every refusal", () => {
    const reasons: TextPromotionRefusal[] = [
      "parse-error",
      "not-found",
      "not-plain-text",
      "inside-loop",
      "inside-expression",
      "not-in-default-component",
      "in-nested-component",
      "props-not-destructured",
      "props-type-elsewhere",
      "no-field-capability",
      "call-site-not-found",
      "call-site-opaque",
    ];
    for (const reason of reasons) {
      expect(describeTextPromotionRefusal(reason).length).toBeGreaterThan(10);
    }
  });
});
