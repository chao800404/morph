// @vitest-environment node
/**
 * `mode=template` (contract v2) through the real service binding in local
 * workerd, on the `.astro` shapes the M2 projection experiment found it
 * needs. Every range is asserted by slicing the source: a range is right
 * when the text it cuts out is exactly the text it names.
 *
 * Kept out of worker.test.ts on purpose: that file holds the admission slot
 * open to time it and runs in a phase of its own. Nothing here is timed.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { join, relative } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  ASTRO_TEMPLATE_FRAGMENT_TAG,
  checkAstroParseResponse,
  type AstroParseOutline,
  type AstroParseRequest,
  type AstroParseTemplate,
} from "./contract";
import {
  PACKAGE_DIR,
  startLocalAstroParser,
  type LocalAstroParser,
} from "./testing/local-binding";

const FIXTURES = join(PACKAGE_DIR, "..", "..", "fixtures", "astro");

const INSTALLED_COMPILER = (
  createRequire(join(PACKAGE_DIR, "package.json"))(
    "@astrojs/compiler-binding-wasm32-wasi/package.json",
  ) as { version: string }
).version;

function astroFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (name === "node_modules") return [];
    if (statSync(path).isDirectory()) return astroFiles(path);
    return name.endsWith(".astro") ? [path] : [];
  });
}

async function sha256Hex(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

let parser: LocalAstroParser;
beforeAll(async () => {
  parser = await startLocalAstroParser();
}, 60_000);
afterAll(() => parser?.dispose());

async function call(source: string, request: AstroParseRequest) {
  const bytes = new TextEncoder().encode(source);
  const query =
    request.mode === "at"
      ? `mode=at&offset=${request.offset}`
      : `mode=${request.mode}`;
  const response = await parser.binding.fetch(
    `https://astro-parser/parse/v1?${query}`,
    { method: "POST", body: bytes },
  );
  const payload = (await response.json()) as unknown;
  return { status: response.status, payload, bytes };
}

/** A template answer that must succeed and pass the contract check. */
async function template(source: string): Promise<AstroParseTemplate> {
  const request = { mode: "template" } as const;
  const { status, payload, bytes } = await call(source, request);
  expect(status, JSON.stringify(payload)).toBe(200);
  const check = checkAstroParseResponse(payload, {
    request,
    sourceSha256: await sha256Hex(bytes),
    sourceBytes: bytes.byteLength,
    sourceLength: source.length,
  });
  expect(check, JSON.stringify(payload).slice(0, 500)).toMatchObject({
    ok: true,
  });
  return payload as AstroParseTemplate;
}

const cut = (source: string, start: number | null, end: number | null) =>
  start === null || end === null ? null : source.slice(start, end);

/** The answer as the texts its ranges cut out of `source`. */
function view(source: string, answer: AstroParseTemplate) {
  return {
    frontmatter: answer.frontmatter && cut(source, ...answer.frontmatter),
    inner: answer.frontmatterInner && cut(source, ...answer.frontmatterInner),
    elements: answer.elements.map(([start, end, tag, parent]) => ({
      tag: answer.tags[tag],
      text: cut(source, start, end),
      parent,
    })),
    attributes: answer.attributes.map(
      ([element, kind, name, nameStart, nameEnd, valueStart, valueEnd]) => ({
        element,
        kind,
        name,
        nameText: cut(source, nameStart, nameEnd),
        value: cut(source, valueStart, valueEnd),
      }),
    ),
    expressions: answer.expressions.map(
      ([start, end, innerStart, innerEnd, owner, attribute, jsx]) => ({
        text: cut(source, start, end),
        inner: cut(source, innerStart, innerEnd),
        owner,
        attribute,
        jsx,
      }),
    ),
  };
}

const ROADMAP_FRONTMATTER =
  'import Hero from "../components/Hero.astro";\n' +
  'import { morph } from "@morph/sdk/astro";\n' +
  'const home = await morph.pages.get("/");\n' +
  "const { hero } = home;\n";

describe("mode=template", () => {
  it("names the compiler it loaded", async () => {
    const answer = await template("<p/>");
    expect(answer.compiler).toBe(INSTALLED_COMPILER);
    expect(answer).toMatchObject({ v: 2, mode: "template" });
  });

  it("answers the ROADMAP homepage case", async () => {
    const source = `---\n${ROADMAP_FRONTMATTER}---\n<Hero {...hero} />\n`;
    const answer = await template(source);
    expect(answer.frontmatter![0]).toBe(0);
    expect(view(source, answer)).toEqual({
      frontmatter: `---\n${ROADMAP_FRONTMATTER}---`,
      inner: `\n${ROADMAP_FRONTMATTER}`,
      elements: [{ tag: "Hero", text: "<Hero {...hero} />", parent: -1 }],
      attributes: [
        { element: 0, kind: "spread", name: "...", nameText: null, value: "hero" },
      ],
      expressions: [
        { text: "{...hero}", inner: "hero", owner: 0, attribute: 0, jsx: [] },
      ],
    });
    expect(answer).toMatchObject({
      elementCount: 1,
      maxDepth: 0,
      diagnostics: { total: 0, first: [] },
    });
  });

  it("keeps per-field props of two instances of one component apart", async () => {
    const source =
      '---\nconst about = await morph.pages.get("/about");\n---\n' +
      "<Hero title={about.intro.title} desc={about.intro.desc} />\n" +
      "<Hero title={about.team.title} desc={about.team.desc} />\n";
    const { elements, attributes, expressions } = view(
      source,
      await template(source),
    );
    expect(elements).toEqual([
      {
        tag: "Hero",
        text: "<Hero title={about.intro.title} desc={about.intro.desc} />",
        parent: -1,
      },
      {
        tag: "Hero",
        text: "<Hero title={about.team.title} desc={about.team.desc} />",
        parent: -1,
      },
    ]);
    expect(attributes).toEqual([
      { element: 0, kind: "expression", name: "title", nameText: "title", value: "{about.intro.title}" },
      { element: 0, kind: "expression", name: "desc", nameText: "desc", value: "{about.intro.desc}" },
      { element: 1, kind: "expression", name: "title", nameText: "title", value: "{about.team.title}" },
      { element: 1, kind: "expression", name: "desc", nameText: "desc", value: "{about.team.desc}" },
    ]);
    expect(expressions).toEqual([
      { text: "{about.intro.title}", inner: "about.intro.title", owner: 0, attribute: 0, jsx: [] },
      { text: "{about.intro.desc}", inner: "about.intro.desc", owner: 0, attribute: 1, jsx: [] },
      { text: "{about.team.title}", inner: "about.team.title", owner: 1, attribute: 2, jsx: [] },
      { text: "{about.team.desc}", inner: "about.team.desc", owner: 1, attribute: 3, jsx: [] },
    ]);
  });

  it("gives nested JSX inside a condition with its owner and parent", async () => {
    const source = "<main>{cond && <div><Hero {...hero} /></div>}</main>";
    const answer = await template(source);
    expect(view(source, answer)).toMatchObject({
      elements: [
        { tag: "main", text: source, parent: -1 },
        { tag: "div", text: "<div><Hero {...hero} /></div>", parent: 0 },
        { tag: "Hero", text: "<Hero {...hero} />", parent: 1 },
      ],
      expressions: [
        {
          text: "{cond && <div><Hero {...hero} /></div>}",
          inner: "cond && <div><Hero {...hero} /></div>",
          owner: 0,
          attribute: -1,
          jsx: [1],
        },
        { text: "{...hero}", inner: "hero", owner: 2, attribute: 0, jsx: [] },
      ],
    });
    expect(answer.maxDepth).toBe(2);
  });

  it("gives the JSX a .map callback returns, and the containers inside it", async () => {
    const source =
      "<ul>{items.map((item) => <li><Card title={item.title} /></li>)}</ul>";
    expect(view(source, await template(source))).toMatchObject({
      elements: [
        { tag: "ul", parent: -1 },
        { tag: "li", text: "<li><Card title={item.title} /></li>", parent: 0 },
        { tag: "Card", text: "<Card title={item.title} />", parent: 1 },
      ],
      expressions: [
        {
          text: "{items.map((item) => <li><Card title={item.title} /></li>)}",
          owner: 0,
          attribute: -1,
          jsx: [1],
        },
        { text: "{item.title}", inner: "item.title", owner: 2, attribute: 0, jsx: [] },
      ],
    });
  });

  it("gives every outermost JSX of one expression, in order", async () => {
    const source = "<div>{c ? <A /> : <><B /></>}</div>";
    expect(view(source, await template(source))).toMatchObject({
      elements: [
        { tag: "div", parent: -1 },
        { tag: "A", text: "<A />", parent: 0 },
        { tag: ASTRO_TEMPLATE_FRAGMENT_TAG, text: "<><B /></>", parent: 0 },
        { tag: "B", text: "<B />", parent: 2 },
      ],
      expressions: [{ inner: "c ? <A /> : <><B /></>", owner: 0, jsx: [1, 2] }],
    });
  });

  it("names <Fragment> by its source text and <> by the fragment tag", async () => {
    const source = "<Fragment><Hero /></Fragment>\n<><Card /></>";
    expect(view(source, await template(source)).elements).toEqual([
      { tag: "Fragment", text: "<Fragment><Hero /></Fragment>", parent: -1 },
      { tag: "Hero", text: "<Hero />", parent: 0 },
      { tag: ASTRO_TEMPLATE_FRAGMENT_TAG, text: "<><Card /></>", parent: -1 },
      { tag: "Card", text: "<Card />", parent: 2 },
    ]);
  });

  it("gives Astro attribute forms verbatim: class:list, set:html, shorthand, backtick", async () => {
    const source =
      '<div class:list={["a", { b: on }]} set:html={html} {title} data-x=`t-${a}` hidden lang="zh" {...rest} />';
    const answer = await template(source);
    const { attributes, expressions } = view(source, answer);
    expect(attributes).toEqual([
      { element: 0, kind: "expression", name: "class:list", nameText: "class:list", value: '{["a", { b: on }]}' },
      { element: 0, kind: "expression", name: "set:html", nameText: "set:html", value: "{html}" },
      // Shorthand: the compiler reads the name from inside the braces.
      { element: 0, kind: "expression", name: "title", nameText: "title", value: "{title}" },
      // Backtick: a container without braces, the template literal itself.
      { element: 0, kind: "expression", name: "data-x", nameText: "data-x", value: "`t-${a}`" },
      { element: 0, kind: "boolean", name: "hidden", nameText: "hidden", value: null },
      { element: 0, kind: "literal", name: "lang", nameText: "lang", value: '"zh"' },
      { element: 0, kind: "spread", name: "...", nameText: null, value: "rest" },
    ]);
    expect(expressions).toEqual([
      { text: '{["a", { b: on }]}', inner: '["a", { b: on }]', owner: 0, attribute: 0, jsx: [] },
      { text: "{html}", inner: "html", owner: 0, attribute: 1, jsx: [] },
      { text: "{title}", inner: "title", owner: 0, attribute: 2, jsx: [] },
      { text: "`t-${a}`", inner: "`t-${a}`", owner: 0, attribute: 3, jsx: [] },
      { text: "{...rest}", inner: "rest", owner: 0, attribute: 6, jsx: [] },
    ]);
    // The shorthand's name lies inside its value; the backtick container
    // starts where its expression does.
    const shorthand = answer.attributes[2];
    expect(shorthand[3]! > shorthand[5]! && shorthand[4]! < shorthand[6]!).toBe(true);
    expect(answer.expressions[3][0]).toBe(answer.expressions[3][2]);
  });

  it("gives an element as an attribute value, and JSX inside an attribute's container", async () => {
    const source = "<A slot=<b/> c={<i/>} />";
    expect(view(source, await template(source))).toEqual({
      frontmatter: null,
      inner: null,
      elements: [
        { tag: "A", text: source, parent: -1 },
        { tag: "b", text: "<b/>", parent: 0 },
        { tag: "i", text: "<i/>", parent: 0 },
      ],
      attributes: [
        { element: 0, kind: "element", name: "slot", nameText: "slot", value: "<b/>" },
        { element: 0, kind: "expression", name: "c", nameText: "c", value: "{<i/>}" },
      ],
      expressions: [
        { text: "{<i/>}", inner: "<i/>", owner: 0, attribute: 1, jsx: [2] },
      ],
    });
  });

  it("keeps comments out of the elements and inside the frontmatter's inner range", async () => {
    const source =
      "---\n// leading comment\nconst a = 1; /* trailing */\n---\n" +
      "<!-- html comment -->\n<p>{/* jsx comment */}{a}</p>\n";
    expect(view(source, await template(source))).toEqual({
      frontmatter: "---\n// leading comment\nconst a = 1; /* trailing */\n---",
      inner: "\n// leading comment\nconst a = 1; /* trailing */\n",
      elements: [
        { tag: "p", text: "<p>{/* jsx comment */}{a}</p>", parent: -1 },
      ],
      attributes: [],
      expressions: [
        // The compiler's empty expression spans the comment.
        { text: "{/* jsx comment */}", inner: "/* jsx comment */", owner: 0, attribute: -1, jsx: [] },
        { text: "{a}", inner: "a", owner: 0, attribute: -1, jsx: [] },
      ],
    });
  });

  it("leaves JSX in the frontmatter and a script's body out of the template", async () => {
    const source =
      "---\nconst x = <b/>;\n---\n<p>{x}</p><script>const y = <i/>;</script>";
    const answer = await template(source);
    expect(answer.tags).toEqual(["p", "script"]);
    expect(answer.elementCount).toBe(2);
  });

  it("gives UTF-16 offsets on CRLF, CJK, emoji and astral text", async () => {
    const source =
      '---\r\nconst 標題 = "你好 😀 𠮷";\r\n---\r\n' +
      '<section title="中文 😀">\r\n  <h1>{標題}</h1>\r\n' +
      '  𠮷😀 <Hero alt="🎉" {...hero} />\r\n</section>\r\n';
    const answer = await template(source);
    expect(view(source, answer)).toEqual({
      frontmatter: '---\r\nconst 標題 = "你好 😀 𠮷";\r\n---',
      inner: '\r\nconst 標題 = "你好 😀 𠮷";\r\n',
      elements: [
        {
          tag: "section",
          text: source.slice(source.indexOf("<section"), source.lastIndexOf("\r\n")),
          parent: -1,
        },
        { tag: "h1", text: "<h1>{標題}</h1>", parent: 0 },
        { tag: "Hero", text: '<Hero alt="🎉" {...hero} />', parent: 0 },
      ],
      attributes: [
        { element: 0, kind: "literal", name: "title", nameText: "title", value: '"中文 😀"' },
        { element: 2, kind: "literal", name: "alt", nameText: "alt", value: '"🎉"' },
        { element: 2, kind: "spread", name: "...", nameText: null, value: "hero" },
      ],
      expressions: [
        { text: "{標題}", inner: "標題", owner: 1, attribute: -1, jsx: [] },
        { text: "{...hero}", inner: "hero", owner: 2, attribute: 2, jsx: [] },
      ],
    });
    // The numbers themselves: UTF-16 units, which differ from both UTF-8
    // bytes and code points past the astral characters.
    const hero = source.indexOf("<Hero");
    expect(answer.elements[2][0]).toBe(hero);
    const prefix = source.slice(0, hero);
    expect(new TextEncoder().encode(prefix).byteLength).not.toBe(hero);
    expect([...prefix].length).not.toBe(hero);
  });

  it("says null for a file without frontmatter, where v1 modes keep [0, 0]", async () => {
    const source = "<p>{a}</p>";
    const answer = await template(source);
    expect(answer.frontmatter).toBeNull();
    expect(answer.frontmatterInner).toBeNull();
    const outline = (await call(source, { mode: "outline" }))
      .payload as AstroParseOutline;
    expect(outline.frontmatter).toEqual([0, 0]);
  });

  it("finds the fences after leading whitespace", async () => {
    const source = "\n  ---\nconst a = 1;\n---\n<p/>";
    expect(view(source, await template(source))).toMatchObject({
      frontmatter: "\n  ---\nconst a = 1;\n---",
      inner: "\nconst a = 1;\n",
    });
  });

  it("still answers a source with diagnostics, and counts them", async () => {
    const broken = await template("<p>{a + }</p>");
    expect(broken.diagnostics.total).toBe(1);
    // Fences the compiler does not confirm: frontmatter without inner range.
    const dashes = await template("----\nconst a = 1;\n----\n<p/>");
    expect(dashes.diagnostics.total).toBeGreaterThan(0);
    expect(dashes.frontmatter).not.toBeNull();
    expect(dashes.frontmatterInner).toBeNull();
  });

  it("refuses an answer over the cap as result-too-large", async () => {
    const { status, payload } = await call("<i/>".repeat(25_250), {
      mode: "template",
    });
    expect(status).toBe(422);
    expect(payload).toMatchObject({
      v: 2,
      ok: false,
      error: { code: "result-too-large" },
    });
  });

  const fixtures = astroFiles(FIXTURES);
  it.each(fixtures.map((path) => [relative(FIXTURES, path), path]))(
    "answers %s with ranges that cut out what they name",
    async (_, path) => {
      const source = readFileSync(path, "utf8");
      const answer = await template(source);
      expect(answer.diagnostics.total).toBe(0);
      expect(answer.elementCount).toBeGreaterThan(0);
      for (const [start, end, tag] of answer.elements) {
        const name = answer.tags[tag];
        const text = source.slice(start, end);
        if (name === ASTRO_TEMPLATE_FRAGMENT_TAG) expect(text).toMatch(/^<>/);
        else expect(text.startsWith(`<${name}`)).toBe(true);
        expect(text.endsWith(">")).toBe(true);
      }
      for (const [, kind, name, nameStart, nameEnd] of answer.attributes) {
        if (kind !== "spread") expect(cut(source, nameStart, nameEnd)).toBe(name);
      }
      for (const [start, end, innerStart] of answer.expressions) {
        const text = source.slice(start, end);
        if (start === innerStart) expect(text).toMatch(/^`[\s\S]*`$/);
        else expect(text).toMatch(/^\{[\s\S]*\}$/);
      }
      if (answer.frontmatterInner) {
        const [innerStart, innerEnd] = answer.frontmatterInner;
        expect(source.slice(innerStart - 3, innerStart)).toBe("---");
        expect(source.slice(innerEnd, innerEnd + 3)).toBe("---");
      }
    },
  );
});
