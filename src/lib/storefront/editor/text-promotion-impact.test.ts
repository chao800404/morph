// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  confirmsTextPromotionImpact,
  textPromotionSharedImpact,
  type TextPromotionImpactInput,
} from "./text-promotion-impact";

const COPY = "src/components/page-sections/index/promo/index.tsx";
const COMPONENT = `export default function Promo({}) { return <p>hi</p>; }\n`;

const home = (body = `<Promo {...content("promo")} />`) => ({
  path: "src/routes/index.tsx",
  content: `import { content } from "../morph/content";
import Promo from "../components/page-sections/index/promo";
export default function Home() {
  return <main>${body}</main>;
}
`,
});

function impact(overrides: Partial<TextPromotionImpactInput> = {}) {
  return textPromotionSharedImpact({
    files: [{ path: COPY, content: COMPONENT }, home()],
    componentSourcePath: COPY,
    callSitePath: "src/routes/index.tsx",
    templateId: "home",
    slotId: "promo",
    documents: [
      {
        templateId: "home",
        label: "/",
        sections: [{ id: "promo", componentRef: COPY }],
      },
    ],
    ...overrides,
  });
}

describe("textPromotionSharedImpact", () => {
  it("is empty for a page's own copy, rendered once", () => {
    expect(impact()).toEqual([]);
  });

  it("names the section library when the component is library source", () => {
    const path = "src/components/sections/Promo.tsx";
    expect(
      impact({
        componentSourcePath: path,
        files: [
          { path, content: COMPONENT },
          {
            path: "src/routes/index.tsx",
            content: `import { content } from "../morph/content";
import Promo from "../components/sections/Promo";
export default function Home() { return <Promo {...content("promo")} />; }
`,
          },
        ],
        documents: [],
      }),
    ).toEqual([
      "Section library: every section added from src/components/sections/Promo.tsx from now on",
    ]);
  });

  it("names every other file that imports it", () => {
    expect(
      impact({
        files: [
          { path: COPY, content: COMPONENT },
          home(),
          {
            path: "src/routes/about.tsx",
            content: `import Promo from "../components/page-sections/index/promo/index";
export default function About() { return <Promo />; }
`,
          },
        ],
      }),
    ).toEqual(["src/routes/about.tsx"]);
  });

  it("names the page when it renders the component more than once", () => {
    expect(
      impact({
        files: [
          { path: COPY, content: COMPONENT },
          home(`<Promo {...content("promo")} /><Promo />`),
        ],
      }),
    ).toEqual(["src/routes/index.tsx (renders it 2 times)"]);
  });

  it("names other documents that store the component", () => {
    expect(
      impact({
        documents: [
          {
            templateId: "home",
            label: "/",
            sections: [
              { id: "promo", componentRef: COPY },
              { id: "promo-2", componentRef: COPY },
            ],
          },
          {
            templateId: "about",
            label: "/about",
            sections: [{ id: "promo", componentRef: COPY }],
          },
        ],
      }),
    ).toEqual(['/: section "promo-2"', '/about: section "promo"']);
  });

  it("counts a file it cannot read as reaching the component", () => {
    expect(
      impact({
        files: [
          { path: COPY, content: COMPONENT },
          home(),
          { path: "src/routes/broken.tsx", content: "export default (" },
        ],
      }),
    ).toEqual(["src/routes/broken.tsx (could not be read)"]);
  });
});

describe("confirmsTextPromotionImpact", () => {
  it("needs no confirmation when nothing else is reached", () => {
    expect(confirmsTextPromotionImpact([], undefined)).toBe(true);
  });

  it("needs exactly the list, in any order", () => {
    const list = ["a", "b"];
    expect(confirmsTextPromotionImpact(list, undefined)).toBe(false);
    expect(confirmsTextPromotionImpact(list, ["a"])).toBe(false);
    expect(confirmsTextPromotionImpact(list, ["a", "b", "c"])).toBe(false);
    expect(confirmsTextPromotionImpact(list, ["b", "a"])).toBe(true);
  });
});
