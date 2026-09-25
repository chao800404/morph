// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  isValidTextFieldName,
  rewriteTextPromotion,
  textFieldLabel,
} from "./text-promotion-rewrite";

const CONTENT = {
  path: "src/morph/content.ts",
  content: "export function content(slot: string) { return {}; }\n",
};

function rewrite(
  component: string,
  options: {
    path?: string;
    targetKey?: string;
    fieldName?: string;
    routeElement?: string;
  } = {},
) {
  const path = options.path ?? "src/components/sections/Promo.tsx";
  const importPath = `../${path.replace(/^src\//, "").replace(/\.tsx$/, "")}`;
  return rewriteTextPromotion({
    files: [
      CONTENT,
      { path, content: component },
      {
        path: "src/routes/index.tsx",
        content: `import { content } from "../morph/content";
import Promo from "${importPath}";
export default function Home() {
  return <main>${options.routeElement ?? `<Promo {...content("promo")} />`}</main>;
}
`,
      },
    ],
    componentSourcePath: path,
    targetKey: options.targetKey ?? "3:5",
    slotId: "promo",
    routeSourcePath: "src/routes/index.tsx",
    fieldName: options.fieldName ?? "text",
  });
}

describe("rewriteTextPromotion", () => {
  it("turns the text into a prop whose default is the text", () => {
    expect(
      rewrite(`export default function Promo({}) {
  return (
    <p className="lead">hello world</p>
  );
}
`),
    ).toEqual({
      status: "rewritten",
      fieldName: "text",
      text: "hello world",
      content: `export default function Promo({ text = "hello world" }) {
  return (
    <p className="lead">{text}</p>
  );
}
`,
    });
  });

  it("keeps the rendered text, not the source's line breaks, as the default", () => {
    const result = rewrite(
      `export default function Promo({ eyebrow = "New" }) {
  return (
    <h2>
      Quiet &amp; calm
      rituals
    </h2>
  );
}
`,
      { fieldName: "heading" },
    );
    expect(result).toMatchObject({
      status: "rewritten",
      content: `export default function Promo({ eyebrow = "New", heading = "Quiet & calm rituals" }) {
  return (
    <h2>{heading}</h2>
  );
}
`,
    });
  });

  it("follows props written one per line, with or without a trailing comma", () => {
    expect(
      rewrite(
        `export default function Promo({
  eyebrow = "New",
  tone,
}) {
  return <p>hello</p>;
}
`,
        { targetKey: "5:10" },
      ),
    ).toMatchObject({
      content: `export default function Promo({
  eyebrow = "New",
  tone,
  text = "hello",
}) {
  return <p>{text}</p>;
}
`,
    });
    expect(
      rewrite(
        `export default function Promo({
  eyebrow = "New"
}) {
  return <p>hello</p>;
}
`,
        { targetKey: "4:10" },
      ),
    ).toMatchObject({
      content: `export default function Promo({
  eyebrow = "New",
  text = "hello"
}) {
  return <p>{text}</p>;
}
`,
    });
  });

  it("adds the prop to a props type this file defines", () => {
    expect(
      rewrite(
        `type PromoProps = {
  eyebrow?: string;
};
export default function Promo({ eyebrow }: PromoProps) {
  return <p>hello</p>;
}
`,
        { targetKey: "5:10" },
      ),
    ).toMatchObject({
      content: `type PromoProps = {
  eyebrow?: string;
  text?: string;
};
export default function Promo({ eyebrow, text = "hello" }: PromoProps) {
  return <p>{text}</p>;
}
`,
    });
    expect(
      rewrite(
        `interface PromoProps { eyebrow?: string }
export default function Promo({ eyebrow }: PromoProps) {
  return <p>hello</p>;
}
`,
        { targetKey: "3:10" },
      ),
    ).toMatchObject({
      content: `interface PromoProps { eyebrow?: string; text?: string }
export default function Promo({ eyebrow, text = "hello" }: PromoProps) {
  return <p>{text}</p>;
}
`,
    });
    expect(
      rewrite(
        `export default function Promo({}: {}) {
  return <p>hello</p>;
}
`,
        { targetKey: "2:10" },
      ),
    ).toMatchObject({
      content: `export default function Promo({ text = "hello" }: { text?: string }) {
  return <p>{text}</p>;
}
`,
    });
  });

  it("declares the field beside the others in a colocated declaration", () => {
    expect(
      rewrite(
        `export const contentFields = {
  title: { type: "text", label: "Title" },
} as const;

export default function Banner({ title = "Hi" }) {
  return <p>Fixed line</p>;
}
`,
        {
          path: "src/components/Banner.tsx",
          targetKey: "6:10",
          fieldName: "subtitle",
        },
      ),
    ).toMatchObject({
      status: "rewritten",
      content: `export const contentFields = {
  title: { type: "text", label: "Title" },
  subtitle: { type: "text", label: "Subtitle" },
} as const;

export default function Banner({ title = "Hi", subtitle = "Fixed line" }) {
  return <p>{subtitle}</p>;
}
`,
    });
  });

  it("escapes the text into a string the source can hold", () => {
    const result = rewrite(
      `export default function Promo({}) {
  return (
    <p>Say "hi" \\ bye</p>
  );
}
`,
    );
    expect(result).toMatchObject({
      status: "rewritten",
      text: 'Say "hi" \\ bye',
    });
    expect(result.status === "rewritten" && result.content).toContain(
      'text = "Say \\"hi\\" \\\\ bye"',
    );
  });

  it("refuses a name that is taken, reserved, or not an identifier", () => {
    const source = `export default function Promo({ eyebrow }) {
  return (
    <p>hello</p>
  );
}
`;
    expect(rewrite(source, { fieldName: "eyebrow" })).toEqual({
      status: "refused",
      reason: "name-taken",
    });
    expect(
      rewrite(source, {
        fieldName: "pinned",
        routeElement: `<Promo {...content("promo")} pinned="x" />`,
      }),
    ).toEqual({ status: "refused", reason: "name-taken" });
    for (const name of ["children", "class", "2nd", "my-text", ""]) {
      expect(rewrite(source, { fieldName: name })).toEqual({
        status: "refused",
        reason: "invalid-name",
      });
    }
  });

  it("refuses whatever the analysis refuses", () => {
    expect(
      rewrite(`export default function Promo(props) {
  return (
    <p>hello</p>
  );
}
`),
    ).toEqual({ status: "refused", reason: "props-not-destructured" });
  });
});

describe("field names", () => {
  it("labels a name for the Content tab", () => {
    expect(textFieldLabel("heading2")).toBe("Heading 2");
    expect(textFieldLabel("ctaLabel")).toBe("Cta label");
    expect(textFieldLabel("sub_title")).toBe("Sub title");
    expect(textFieldLabel("e2eNote")).toBe("E2e note");
  });

  it("accepts identifiers only", () => {
    expect(isValidTextFieldName("heading")).toBe(true);
    expect(isValidTextFieldName("_x")).toBe(false);
    expect(isValidTextFieldName("default")).toBe(false);
  });
});
