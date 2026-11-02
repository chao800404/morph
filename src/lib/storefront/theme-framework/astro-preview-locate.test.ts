// @vitest-environment node
import { parse as babelParse } from "@babel/parser";
import { transformSync } from "esbuild";
import crypto from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  ASTRO_BOUNDARY_RULE_VERSION,
  ASTRO_PREVIEW_BOUNDARY_MARKER,
  astroBoundaryCandidates,
  astroPreviewBoundaryAlias,
  astroPreviewLocatePluginSource,
  astroPreviewMarkerNonce,
  astroPreviewSourceHash,
  astroTopLevelBindingNames,
  formatAstroInstanceIdentity,
  parseAstroInstanceIdentity,
} from "./astro-preview-locate";
import { planAstroPreviewWorkspace } from "./astro-preview-workspace";
import { THEME_PREVIEW_START_CLIENT_PATH } from "../compiler/theme-preview-start-runtime";
import { PREVIEW_BOUNDARY_MARKER } from "../editor/preview-dom";
import {
  astroCompilerVersion,
  compileAstroInNode,
  parseAstroInNode,
  runAstroPreviewLocatePlugin,
} from "@/lib/test-utils/astro-compiler-node";

// L1.5a (docs/astro-theme-plan.md 3.6.2.2) and instance identity v2 (M2
// PR-I). The plugin runs here on compiler-rs 0.5.1's Wasm build in Node, the
// version the toolchain pins; the container runs the native build of the same
// version, which the container smoke test (U3) and U1 cover, not this file.

const NONCE = "0123456789abcdef";
const ALIAS = astroPreviewBoundaryAlias(NONCE);
const sha256 = (text: string) =>
  crypto.createHash("sha256").update(text, "utf8").digest("hex");

/** The product plugin, given this compiler instead of its dynamic import. */
const annotate = (source: string, file = "src/pages/index.astro") =>
  runAstroPreviewLocatePlugin(source, file, NONCE);

/** Boundary ids in an annotated (or compiled) text, opening markers only. */
const markerIds = (text: string) =>
  [...text.matchAll(/<!--morph:s2 ([^-"]+)-->/g)].map((match) => match[1]!);

/** Every Morph insertion removed again: must give back the author's text. */
function withoutInsertions(annotated: string): string {
  const aliasImport =
    'import \\{ Fragment as MorphBoundary\\$[0-9a-f]{16} \\} from "astro/runtime/server/index\\.js";\\n';
  return annotated
    .replace(new RegExp(`^---\\n${aliasImport}---\\n`), "")
    .replace(new RegExp(aliasImport), "")
    .replace(
      /(<>)?<MorphBoundary\$[0-9a-f]{16} set:html=\{"<!--\/?morph:s2 [^"]+-->"\} \/>(<\/>)?/g,
      "",
    )
    .replace(
      / data-morph-loc="[^"]*" data-morph-loc-v="[0-9a-f]{8}" data-morph-loc-s="[0-9a-f]{64}"/g,
      "",
    );
}

const renderCalls = (code: string) =>
  [
    ...code.matchAll(
      /\$\$renderComponent\(\$\$result, "([^"]+)", ([A-Za-z_$.0-9]+)/g,
    ),
  ].map((match) => `${match[1]} -> ${match[2]}`);

const moduleValid = (code: string) => {
  try {
    babelParse(code, { sourceType: "module" });
    return true;
  } catch {
    return false;
  }
};

/** Q5 experiment samples (exp/m2-astro-projection 12ba486). */
const SAMPLES = {
  builtin:
    '---\nimport Hero from "../components/Hero.astro";\n---\n<Hero title="a" />\n<Fragment><p>x</p></Fragment>\n',
  builtinSlot:
    '---\nimport Card from "../components/Card.astro";\n---\n<Card><Fragment slot="title"><b>t</b></Fragment><p>body</p></Card>\n',
  importDefault:
    '---\nimport Fragment from "../components/Fragment.astro";\nimport Hero from "../components/Hero.astro";\n---\n<Hero title="a" />\n<Fragment title="b" />\n',
  importAlias:
    '---\nimport { Badge as Fragment } from "../components/ui";\nimport Hero from "../components/Hero.astro";\n---\n<Hero title="a" />\n<Fragment label="b" />\n',
  importUnusedTag:
    '---\nimport Fragment from "../components/Fragment.astro";\nimport Hero from "../components/Hero.astro";\nconst label = String(Fragment);\n---\n<Hero title={label} />\n',
  localConst:
    '---\nimport Hero from "../components/Hero.astro";\nconst Fragment = Hero;\n---\n<Hero title={String(Fragment)} />\n',
  member:
    '---\nimport * as UI from "../components/ui";\nimport Hero from "../components/Hero.astro";\n---\n<Hero title="a" />\n<UI.Fragment label="b" />\n',
  nested:
    '---\nimport Card from "../components/Card.astro";\nimport Badge from "../components/Badge.astro";\n---\n<Card><Badge label="n" /></Card>\n',
} as const;
type SampleName = keyof typeof SAMPLES;

/** How many boundary candidates each sample has under rule v2. */
const EXPECTED_CANDIDATES: Record<SampleName, number> = {
  builtin: 1,
  builtinSlot: 1,
  importDefault: 2,
  importAlias: 2,
  importUnusedTag: 1,
  localConst: 1,
  member: 2,
  nested: 2,
};

describe("the Astro preview locate pass", () => {
  it("derives a fixed-format nonce per preview", () => {
    const nonce = astroPreviewMarkerNonce("preview-1");
    expect(nonce).toMatch(/^[0-9a-f]{16}$/);
    expect(astroPreviewMarkerNonce("preview-1")).toBe(nonce);
    expect(astroPreviewMarkerNonce("preview-2")).not.toBe(nonce);
  });

  it("hashes source text in UTF-16 units", () => {
    expect(astroPreviewSourceHash("")).toBe("811c9dc5");
    expect(astroPreviewSourceHash("😀")).not.toBe(astroPreviewSourceHash("😁"));
  });

  it("emits plugin source that evaluates, and refuses a malformed nonce", () => {
    const source = astroPreviewLocatePluginSource(astroPreviewMarkerNonce("p"));
    const plugin = new Function(
      "fs",
      "path",
      "crypto",
      "workspaceRoot",
      `return ${source}`,
    )({}, {}, {}, "/workspace") as {
      name: string;
      enforce: string;
      load: unknown;
    };
    expect(plugin).toMatchObject({
      name: "morph:astro-preview-locate",
      enforce: "pre",
    });
    expect(typeof plugin.load).toBe("function");
    expect(() => astroPreviewLocatePluginSource('x"); evil();//')).toThrow();
  });

  it("is added to every Astro Live Preview's integration and client", () => {
    const result = planAstroPreviewWorkspace({
      files: [
        { path: "astro.config.mjs", content: "export default {};" },
        { path: "src/pages/index.astro", content: "<p>x</p>" },
      ],
      entry: "src/pages/index.astro",
      buildId: "preview-1",
      dependencies: {},
      approvedDependencies: [],
      mode: "preview-server",
    } as unknown as Parameters<typeof planAstroPreviewWorkspace>[0]);
    if (!result.ok) throw new Error(result.errorMessage);
    const text = (suffix: string) =>
      (
        result.workspaceFiles.find((entry) => entry.path.endsWith(suffix)) as
          { content?: string } | undefined
      )?.content ?? "";
    const integration = text(".morph/astro-preview-integration.mjs");
    expect(integration).toContain("previewLocatePlugin,");
    // The plugin's sha256 is Node's, imported by the integration around it.
    expect(integration).toContain('import crypto from "node:crypto";');
    expect(text(THEME_PREVIEW_START_CLIENT_PATH)).toContain(
      `__morphPreviewSourceSelection = { nonce: "${astroPreviewMarkerNonce("preview-1")}" }`,
    );
  });
});

describe("boundary marker v2 grammar (P1)", () => {
  const id = `${NONCE}:2:${"a".repeat(64)}:120:458`;

  it("is one fixed format, at most 99 characters, read the same by the bridge", () => {
    expect(ASTRO_PREVIEW_BOUNDARY_MARKER.test(`morph:s2 ${id}`)).toBe(true);
    expect(ASTRO_PREVIEW_BOUNDARY_MARKER.test(`/morph:s2 ${id}`)).toBe(true);
    const longest = `${NONCE}:999:${"f".repeat(64)}:999998:999999`;
    expect(longest).toHaveLength(99);
    expect(ASTRO_PREVIEW_BOUNDARY_MARKER.test(`morph:s2 ${longest}`)).toBe(
      true,
    );
    // The bridge's copy (preview-dom.ts) is the same expression.
    expect(PREVIEW_BOUNDARY_MARKER.source).toBe(
      ASTRO_PREVIEW_BOUNDARY_MARKER.source,
    );
  });

  it("does not read the v1 format, or a short digest", () => {
    expect(
      ASTRO_PREVIEW_BOUNDARY_MARKER.test(`morph:s ${NONCE}:0badf00d:12`),
    ).toBe(false);
    expect(
      ASTRO_PREVIEW_BOUNDARY_MARKER.test(`morph:s2 ${NONCE}:2:0badf00d:1:2`),
    ).toBe(false);
  });

  it("parses and formats one identity, canonical numbers only", () => {
    expect(parseAstroInstanceIdentity(id)).toEqual({
      nonce: NONCE,
      rule: 2,
      src: "a".repeat(64),
      start: 120,
      end: 458,
    });
    expect(formatAstroInstanceIdentity(parseAstroInstanceIdentity(id)!)).toBe(
      id,
    );
    expect(parseAstroInstanceIdentity(`${NONCE}:0badf00d:0`)).toBeNull();
    expect(
      parseAstroInstanceIdentity(`${NONCE}:2:${"a".repeat(64)}:0120:458`),
    ).toBeNull();
    expect(
      parseAstroInstanceIdentity(`${NONCE}:2:${"a".repeat(64)}:458:458`),
    ).toBeNull();
    expect(parseAstroInstanceIdentity(null)).toBeNull();
  });
});

describe("the plugin on compiler-rs 0.5.1 (P1, P4, P6)", () => {
  it("runs on the pinned compiler version", () => {
    expect(astroCompilerVersion()).toBe("0.5.1");
  });

  it("brackets exactly the component's source range, keyed by the route file's sha256", async () => {
    const source =
      '---\nimport Hero from "../components/Hero.astro";\nimport Card from "../components/Card.astro";\n---\n' +
      '<main>\n<Hero title="中文🎉" />\n<p>😀{"x"}</p>\n<Card><Hero title="b" /></Card>\n</main>\n';
    for (const variant of [source, source.replace(/\n/g, "\r\n")]) {
      const annotated = (await annotate(variant))!;
      expect(annotated).not.toBeNull();
      // Removing what Morph inserted gives back the author's text exactly.
      expect(withoutInsertions(annotated)).toBe(variant);
      const ids = markerIds(annotated).map((id) =>
        parseAstroInstanceIdentity(id)!,
      );
      expect(ids).toHaveLength(3);
      // Core computes the same value (astro-instance-identity.test.ts).
      const digest = sha256(variant);
      for (const identity of ids) {
        expect(identity).toMatchObject({
          nonce: NONCE,
          rule: ASTRO_BOUNDARY_RULE_VERSION,
          src: digest,
        });
      }
      // UTF-16 offsets into the unmodified source, CRLF and astral included.
      expect(ids.map(({ start, end }) => variant.slice(start, end))).toEqual([
        '<Hero title="中文🎉" />',
        '<Card><Hero title="b" /></Card>',
        '<Hero title="b" />',
      ]);
    }
  });

  it("marks boundaries in route files only, and every located element with its file's sha256", async () => {
    const component =
      '---\nimport Badge from "./Badge.astro";\n---\n<section data-morph-loc-s="forged"><Badge /><h1>t</h1></section>\n';
    const annotated = (await annotate(component, "src/components/Hero.astro"))!;
    expect(markerIds(annotated)).toEqual([]);
    expect(annotated).not.toContain(ALIAS);
    expect(annotated).not.toContain("forged");
    const digests = [...annotated.matchAll(/data-morph-loc-s="([^"]*)"/g)].map(
      (match) => match[1],
    );
    expect(digests).toEqual([sha256(component), sha256(component)]);
    // L1.5a's own attributes are unchanged in kind and value.
    expect(annotated).toContain(
      `data-morph-loc="src/components/Hero.astro:4:1" data-morph-loc-v="${astroPreviewSourceHash(component)}"`,
    );
  });

  it("skips slot= components and the built-in Fragment; marks an author's Fragment of any binding", async () => {
    const counts: Record<string, number> = {};
    for (const name of Object.keys(SAMPLES) as SampleName[]) {
      counts[name] = markerIds((await annotate(SAMPLES[name]))!).length;
    }
    expect(counts).toEqual(EXPECTED_CANDIDATES);
    const source =
      '---\nimport Layout from "../components/Layout.astro";\nimport Hero from "../components/Hero.astro";\n---\n<Layout><Hero slot="main" /></Layout>\n';
    const slot = (await annotate(source))!;
    expect(
      markerIds(slot).map((id) => {
        const { start, end } = parseAstroInstanceIdentity(id)!;
        return source.slice(start, end);
      }),
    ).toEqual(['<Layout><Hero slot="main" /></Layout>']);
  });

  it("leaves the built-in Fragment built in under a type-only import of the name", async () => {
    for (const binding of [
      'import type Fragment from "../components/Fragment.astro";',
      'import { type Fragment } from "../components/ui";',
    ]) {
      const source = `---\n${binding}\n---\n<Fragment><p>x</p></Fragment>\n`;
      const { ast } = parseAstroInNode(source);
      expect(
        astroTopLevelBindingNames(
          (ast.frontmatter as { program: { body: unknown[] } }).program.body,
        ),
      ).toEqual([]);
      expect(markerIds((await annotate(source))!)).toEqual([]);
    }
    // A value import next to it still binds.
    const { ast } = parseAstroInNode(
      '---\nimport { type A, Fragment } from "x";\n---\n<p />\n',
    );
    expect(
      astroTopLevelBindingNames(
        (ast.frontmatter as { program: { body: unknown[] } }).program.body,
      ),
    ).toEqual(["Fragment"]);
  });

  it("puts no marker in a file whose text already holds the reserved alias", async () => {
    const source = `---\nimport Hero from "../components/Hero.astro";\nconst note = "${ALIAS}";\n---\n<Hero title={note} />\n<p>x</p>\n`;
    const annotated = (await annotate(source))!;
    expect(markerIds(annotated)).toEqual([]);
    expect(annotated.split(ALIAS)).toHaveLength(2);
    expect(annotated).toContain('data-morph-loc="src/pages/index.astro:6:1"');
  });

  it("shares one candidate rule with Core: names bound at the top level, either AST dialect", () => {
    const { ast } = parseAstroInNode(
      '---\nimport Fragment from "x";\nimport { A as B } from "y";\nconst { C, d: [E], ...F } = z, G = 1;\nlet [H = 1] = [];\nfunction I() { const J = 1; }\nclass K {}\nexport const L = 1;\n---\n<p />\n',
    );
    const body = (ast.frontmatter as { program: { body: unknown[] } }).program
      .body;
    expect(astroTopLevelBindingNames(body)).toEqual([
      "Fragment",
      "B",
      "C",
      "E",
      "F",
      "G",
      "H",
      "I",
      "K",
      "L",
    ]);
    const element = (tag: string, slotted = false) => ({
      start: 0,
      end: 1,
      tag,
      slotted,
    });
    const rule = (tags: ReturnType<typeof element>[], bound: string[] = []) =>
      astroBoundaryCandidates(tags, bound).length;
    expect(rule([element("Hero"), element("UI.Badge")])).toBe(2);
    expect(
      rule([element("div"), element("#fragment"), element("svg:Rect")]),
    ).toBe(0);
    expect(rule([element("Hero", true)])).toBe(0);
    expect(rule([element("Fragment")])).toBe(0);
    expect(rule([element("Fragment")], ["Fragment"])).toBe(1);
  });
});

describe("Q11: the Fragment preview distortion, before and after", () => {
  /**
   * The v1 injection shape, as main's plugin wrote it: each marker rendered
   * through whatever `Fragment` means in the file.
   */
  function v1Injection(source: string): string {
    const { ast } = parseAstroInNode(source);
    const edits: { at: number; text: string; order: number }[] = [];
    const marker = `${NONCE}:${astroPreviewSourceHash(source)}:0`;
    const visit = (node: unknown): void => {
      if (Array.isArray(node)) return node.forEach(visit);
      if (!node || typeof node !== "object") return;
      const record = node as Record<string, unknown>;
      if (record.type === "JSXElement") {
        const name = (record.openingElement as { name: { name?: string } }).name
          .name;
        if (name && /^[A-Z]/.test(name) && name !== "Fragment") {
          edits.push(
            {
              at: record.start as number,
              order: 1,
              text: `<Fragment set:html={"<!--morph:s ${marker}-->"} />`,
            },
            {
              at: record.end as number,
              order: 0,
              text: `<Fragment set:html={"<!--/morph:s ${marker}-->"} />`,
            },
          );
        }
      }
      for (const [key, value] of Object.entries(record)) {
        if (key !== "frontmatter" && value && typeof value === "object")
          visit(value);
      }
    };
    visit(ast.body);
    edits.sort((a, b) => b.at - a.at || b.order - a.order);
    let out = source;
    for (const edit of edits)
      out = out.slice(0, edit.at) + edit.text + out.slice(edit.at);
    return out;
  }

  it("counterexample: the v1 shape renders the author's Fragment at every marker", () => {
    const raw = compileAstroInNode(SAMPLES.localConst).code;
    const v1 = compileAstroInNode(v1Injection(SAMPLES.localConst)).code;
    expect(v1).toContain("const Fragment = Hero;");
    // `Fragment` is the author's Hero here: two extra Hero renders.
    const authorCalls = (code: string) =>
      renderCalls(code).filter((call) => call === "Fragment -> Fragment");
    expect(authorCalls(raw)).toHaveLength(0);
    expect(authorCalls(v1)).toHaveLength(2);
  });

  it("counterexample, every Q5 sample: which ones the v1 shape distorts", () => {
    // A v1 marker call `$$renderComponent(…, "Fragment", Fragment …)` is a
    // distortion when `Fragment` is the author's binding in the module that
    // runs. With an imported Fragment the compiler's output binds the name
    // twice (O2); after esbuild's TS loader (what a type-stripping Vite
    // pipeline runs) only the author's import is left (O3). Compiler output
    // only: what the container's pipeline runs is U3.
    const distorted: string[] = [];
    for (const name of Object.keys(SAMPLES) as SampleName[]) {
      const source = SAMPLES[name];
      const raw = compileAstroInNode(source).code;
      const v1 = transformSync(compileAstroInNode(v1Injection(source)).code, {
        loader: "ts",
        format: "esm",
      }).code;
      const runtimeFragment = v1
        .split("\n")
        .some(
          (line) =>
            line.includes('from "astro/runtime/server/index.js"') &&
            /[{,]\s*Fragment\s*[,}]/.test(line),
        );
      const fragmentCalls = (code: string) =>
        renderCalls(code).filter((call) => call === "Fragment -> Fragment")
          .length;
      if (fragmentCalls(v1) > fragmentCalls(raw) && !runtimeFragment) {
        distorted.push(name);
      }
    }
    expect(distorted).toEqual([
      "importDefault",
      "importAlias",
      "importUnusedTag",
      "localConst",
    ]);
  });

  it("v2 renders every marker through the reserved alias and leaves the author's Fragment alone", async () => {
    for (const name of Object.keys(SAMPLES) as SampleName[]) {
      const source = SAMPLES[name];
      const raw = compileAstroInNode(source);
      const v2 = compileAstroInNode((await annotate(source))!);
      expect(v2.diagnostics, name).toEqual([]);
      const expected = EXPECTED_CANDIDATES[name];
      // Every marker survives compilation, slot content (`nested`) included.
      expect([...v2.code.matchAll(/<!--\/?morph:s2 /g)].length, name).toBe(
        2 * expected,
      );
      const calls = renderCalls(v2.code);
      expect(
        calls.filter((call) => call === `${ALIAS} -> ${ALIAS}`),
        name,
      ).toHaveLength(2 * expected);
      expect(
        calls.filter((call) => call === "Fragment -> Fragment"),
        name,
      ).toEqual(
        renderCalls(raw.code).filter((call) => call === "Fragment -> Fragment"),
      );
      expect(v2.code, name).toContain(
        `import { Fragment as ${ALIAS} } from "astro/runtime/server/index.js";`,
      );
      // Module validity is what it was without Morph (an imported Fragment
      // is a duplicate binding in the compiler's own output, O2).
      expect(moduleValid(v2.code), name).toBe(moduleValid(raw.code));
    }
  });
});

describe("Q9: the alias import moves Astro's diagnostics, never Morph's positions", () => {
  const lineOf = (text: string, token: string) =>
    text.slice(0, text.indexOf(token)).split("\n").length;

  it("with a frontmatter: one line, from the closing fence on", async () => {
    const source =
      '---\nimport Hero from "../components/Hero.astro";\n---\n<p>before</p>\n<Hero title="x" />\n<p>after</p>\n';
    const annotated = (await annotate(source))!;
    expect(lineOf(annotated, "<p") - lineOf(source, "<p")).toBe(1);
    expect(lineOf(annotated, "after") - lineOf(source, "after")).toBe(1);
    expect(lineOf(annotated, "import Hero")).toBe(
      lineOf(source, "import Hero"),
    );
    // Morph's own location and range still name the original file.
    expect(annotated).toContain('data-morph-loc="src/pages/index.astro:4:1"');
    expect(annotated).toContain('data-morph-loc="src/pages/index.astro:6:1"');
    const [id] = markerIds(annotated);
    const { start, end } = parseAstroInstanceIdentity(id)!;
    expect(source.slice(start, end)).toBe('<Hero title="x" />');
  });

  it("without a frontmatter: a whole block, three lines", async () => {
    const source = '<p>before</p>\n<UI.Hero title="x" />\n<p>after</p>\n';
    const annotated = (await annotate(source))!;
    expect(annotated.startsWith(`---\nimport { Fragment as ${ALIAS} }`)).toBe(
      true,
    );
    expect(lineOf(annotated, "before") - lineOf(source, "before")).toBe(3);
    expect(lineOf(annotated, "after") - lineOf(source, "after")).toBe(3);
    expect(annotated).toContain('data-morph-loc="src/pages/index.astro:1:1"');
    expect(annotated).toContain('data-morph-loc="src/pages/index.astro:3:1"');
    const [id] = markerIds(annotated);
    const { start, end } = parseAstroInstanceIdentity(id)!;
    expect(source.slice(start, end)).toBe('<UI.Hero title="x" />');
    expect(withoutInsertions(annotated)).toBe(source);
    expect(compileAstroInNode(annotated).diagnostics).toEqual([]);
  });
});
