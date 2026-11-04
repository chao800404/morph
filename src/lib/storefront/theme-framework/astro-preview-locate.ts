/**
 * Source locations and section boundary candidates for an Astro Live Preview
 * (L1.5a, docs/astro-theme-plan.md 3.6.2; instance identity v2, M2 PR-I).
 *
 * `.astro` cannot be parsed in Core (the compiler does not fit the Worker,
 * 0.1), so this pass runs inside the preview container, on Astro's own
 * compiler. What it writes is a hint for the editor, never a write target:
 *
 * - `data-morph-loc="src/...:line:column"` on each plain element, pointing at
 *   the element's `<` in the author's source. Lines count from 1 split on
 *   `\n`; columns count from 1 in UTF-16 code units, the unit the compiler's
 *   offsets use. The attribute is reserved for the editor: one the author
 *   wrote is dropped from the preview copy first (their source is untouched).
 * - `data-morph-loc-v`, the source version those locations belong to
 *   (`astroPreviewSourceHash`, FNV-1a). L1.5a's Code jump checks it; it is
 *   not an identity and Design never relies on it.
 * - `data-morph-loc-s`, the full sha256 of that same file's text (UTF-8),
 *   on the same elements (P6). Design compares it with the component file in
 *   Core's snapshot; the bridge forwards it only to an editor that announced
 *   `astro-identity-v2`. Reserved like the other two.
 * - in a route file (`src/pages/**`) only, boundary comments around each
 *   boundary candidate (`astroBoundaryCandidates`, rule
 *   `ASTRO_BOUNDARY_RULE_VERSION`). Their text is fixed-format platform data
 *   only, `morph:s2 <nonce>:<rule>:<sha256 of the route file>:<start>:<end>`,
 *   where start and end are the component element's UTF-16 offsets in the
 *   unmodified route file. No ordinal: the key is the source range, so a
 *   candidate the analysis does not count (a `<UI.Badge/>`) cannot shift the
 *   key of another instance. The nonce tells this preview's markers apart
 *   from text an author wrote in advance; the page can read it, so it is not
 *   a credential and a boundary is never a confirmed binding. Core verifies
 *   every identity itself (astro-instance-identity.ts).
 *
 * The comments are emitted through the runtime `Fragment`, because
 * compiler-rs drops plain comments inside a component's slot content (Q5
 * experiment O4). The runtime `Fragment` is imported under a reserved alias,
 * `MorphBoundary$<nonce>`, added to the frontmatter, because an author may
 * bind the name `Fragment` themselves: a `<Fragment set:html>` marker then
 * renders the author's component (O3, the distortion v1 had). A file whose
 * text already contains the alias gets no markers.
 *
 * The alias names `astro/compiler-runtime`, the entry Astro's own compile
 * hands the compiler (`internalURL`, astro/dist/core/compile/compile.js) and
 * from which every compiled page already imports the built-in `Fragment` and
 * its render helpers, so the alias adds no module the page does not import
 * anyway (PR-I smoke run 1: `astro/runtime/server/index.js` was a second,
 * re-export-only pre-bundled entry).
 *
 * Positions (Q9, revised after smoke run 1). Morph's own positions are
 * computed on the unmodified source and all edits are applied in one pass, so
 * an insertion never shifts a later location (experiment 3 found exactly that
 * when the passes were chained). The edits change the text Astro compiles: the
 * alias import adds a line before the closing fence (a three-line block at the
 * top without a frontmatter), and the attributes and markers lengthen lines.
 * `load` therefore returns a source map of its edits (MagicString, as Astro
 * itself resolves it), which Vite puts first in the module's map chain:
 *
 * - a stack frame the compiler maps into the route file names the author's
 *   own line and column, as for the file without Morph;
 * - a frame the compiler leaves unmapped stays a position in the generated
 *   module, without and with Morph alike, and the alias import's lines move
 *   it; it is not an author position;
 * - known limit: Astro's `CompilerError` locations come from the compiler's
 *   diagnostics on the text it was given and do not pass through source maps.
 *   A file the plugin cannot parse is handed over unannotated, so syntax
 *   errors are the author's; a compile-only diagnostic on an annotated copy
 *   would name the copy's position.
 *
 * Not verified by these unit tests (container smoke test, U3): that a real
 * `astro dev` emits the alias markers and the rest of the page unchanged,
 * that the alias import's module is one the page imports anyway, that error
 * frames map as above, and whether a page importing its own `Fragment`
 * compiles in the container's pipeline at all (O2).
 *
 * Astro compiles `.astro` in its own early transform, so this runs at `load`.
 * Only module ids without a query are handled: Astro serves a file's style and
 * script sub-requests from the compile of that same module.
 */

/** The boundary candidate rule the markers and Core's verification share. */
export const ASTRO_BOUNDARY_RULE_VERSION = 2;

/**
 * Fixed-format boundary marker text, without the comment delimiters: closing
 * slash, nonce, rule, route sha256, start, end. The bridge's copy is
 * `preview-dom.ts`'s (tested equal); the old `morph:s ` format is not read.
 */
export const ASTRO_PREVIEW_BOUNDARY_MARKER =
  /^(\/?)morph:s2 ([0-9a-f]{16}):(\d{1,3}):([0-9a-f]{64}):(\d{1,6}):(\d{1,6})$/;

/**
 * One boundary id, the marker text after `morph:s2 ` (and the
 * `previewBoundary.marker` the bridge reports). `src` is the sha256 of the
 * route file's UTF-8 text; `start`/`end` the component element's UTF-16
 * offsets in it.
 */
export type AstroInstanceIdentity = Readonly<{
  nonce: string;
  rule: number;
  src: string;
  start: number;
  end: number;
}>;

/**
 * The id grammar, canonical numbers only (the plugin never writes a leading
 * zero), so one identity has one spelling.
 */
const ASTRO_INSTANCE_IDENTITY =
  /^([0-9a-f]{16}):(0|[1-9]\d{0,2}):([0-9a-f]{64}):(0|[1-9]\d{0,5}):(0|[1-9]\d{0,5})$/;

/**
 * The identity a boundary id names, or null for anything else: a v1 id
 * (`<nonce>:<8 hex>:<n>`), a malformed one, or an empty range.
 */
export function parseAstroInstanceIdentity(
  id: string | null | undefined,
): AstroInstanceIdentity | null {
  if (typeof id !== "string") return null;
  const match = ASTRO_INSTANCE_IDENTITY.exec(id);
  if (!match) return null;
  const start = Number(match[4]);
  const end = Number(match[5]);
  if (end <= start) return null;
  return {
    nonce: match[1]!,
    rule: Number(match[2]),
    src: match[3]!,
    start,
    end,
  };
}

export function formatAstroInstanceIdentity(
  identity: AstroInstanceIdentity,
): string {
  return `${identity.nonce}:${identity.rule}:${identity.src}:${identity.start}:${identity.end}`;
}

/**
 * The module the alias import names: the runtime entry the compiler's own
 * output imports `Fragment` and its render helpers from. Astro's compile sets
 * it as the compiler's `internalURL` (astro/dist/core/compile/compile.js:
 * `internalURL: "astro/compiler-runtime"`, Astro 7.3.5), an export of the
 * `astro` package. It is not a documented public API, but every compiled
 * `.astro` page already depends on it, so a toolchain without it fails on
 * every page, not only on the markers. `astro/runtime/server/index.js`, used
 * before, resolved to a second pre-bundled entry of the same runtime.
 */
export const ASTRO_COMPILER_RUNTIME_MODULE = "astro/compiler-runtime";

/** The reserved local name the markers render through. */
export function astroPreviewBoundaryAlias(nonce: string): string {
  return `MorphBoundary$${nonce}`;
}

/**
 * The version of one source file as the preview transformed it: FNV-1a over
 * UTF-16 code units. The editor computes it over the file it would open, and
 * refuses a location from any other version. Emitted into the plugin with
 * `toString()`, so the container and the editor run the same function.
 */
export function astroPreviewSourceHash(text: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

/**
 * The value names bound at the top level of a frontmatter program, once per
 * declaration (so a name declared twice is listed twice): value import locals
 * (not `import type X` or `import { type X }`),
 * `var`/`let`/`const` patterns, function, class and enum declarations, and
 * `import x = require()`. Reads compiler-rs's ESTree and Babel alike.
 *
 * Self-contained: emitted into the plugin with `toString()`.
 */
export function astroTopLevelBindingNames(body: readonly unknown[]): string[] {
  const names: string[] = [];
  type Node = { type?: string; [key: string]: unknown } | null | undefined;
  const pattern = (node: Node): void => {
    if (!node || typeof node !== "object") return;
    if (node.type === "Identifier") {
      if (typeof node.name === "string") names.push(node.name);
    } else if (node.type === "ObjectPattern") {
      for (const property of (node.properties as Node[]) ?? []) {
        if (!property) continue;
        pattern(
          (property.type === "RestElement"
            ? property.argument
            : property.value) as Node,
        );
      }
    } else if (node.type === "ArrayPattern") {
      for (const element of (node.elements as Node[]) ?? []) pattern(element);
    } else if (node.type === "RestElement") {
      pattern(node.argument as Node);
    } else if (node.type === "AssignmentPattern") {
      pattern(node.left as Node);
    }
  };
  const declaration = (node: Node): void => {
    if (!node || typeof node !== "object") return;
    if (node.type === "VariableDeclaration") {
      for (const declarator of (node.declarations as Node[]) ?? []) {
        if (declarator) pattern(declarator.id as Node);
      }
    } else if (
      node.type === "FunctionDeclaration" ||
      node.type === "ClassDeclaration" ||
      node.type === "TSEnumDeclaration" ||
      node.type === "TSImportEqualsDeclaration"
    ) {
      pattern(node.id as Node);
    }
  };
  for (const statement of body as Node[]) {
    if (!statement || typeof statement !== "object") continue;
    if (statement.type === "ImportDeclaration") {
      // A type-only import binds no value: `import type Fragment` leaves
      // the built-in `<Fragment>` built in.
      if (statement.importKind === "type") continue;
      for (const specifier of (statement.specifiers as Node[]) ?? []) {
        if (specifier && specifier.importKind !== "type") {
          pattern(specifier.local as Node);
        }
      }
    } else if (
      statement.type === "ExportNamedDeclaration" ||
      statement.type === "ExportDefaultDeclaration"
    ) {
      declaration(statement.declaration as Node);
    } else {
      declaration(statement);
    }
  }
  return names;
}

/**
 * The largest offset a marker can carry (six digits). A candidate ending
 * beyond it gets no marker, so Core treats it as unmarked.
 */
export const ASTRO_BOUNDARY_MAX_OFFSET = 999_999;

/** One template element as the boundary rule reads it. */
export type AstroBoundaryElement = Readonly<{
  start: number;
  end: number;
  /** The opening tag's name as source text: `Hero`, `UI.Badge`, `div`. */
  tag: string;
  /** Whether the element has a `slot` attribute. */
  slotted: boolean;
}>;

/**
 * Boundary candidate rule v2 (design v2 §10), the one rule the plugin and
 * Core apply, in element order, no ordinal:
 *
 * - a component element: a member tag (`UI.Badge`) or a capitalised
 *   identifier; not a namespaced tag, not `<>`;
 * - without a `slot` attribute (its content renders inside another
 *   component; Astro v1 profile limit);
 * - `Fragment` only while the frontmatter binds that name at its top level
 *   (`boundNames`): unbound, it is Astro's built-in and no candidate; bound,
 *   it is the author's component like any other (D90-5, Q5).
 *
 * Self-contained: emitted into the plugin with `toString()`.
 */
export function astroBoundaryCandidates(
  elements: readonly AstroBoundaryElement[],
  boundNames: readonly string[],
): { start: number; end: number }[] {
  const fragmentBound = boundNames.includes("Fragment");
  const candidates: { start: number; end: number }[] = [];
  for (const element of elements) {
    const tag = element.tag;
    if (element.slotted || tag.includes(":")) continue;
    if (!(tag.includes(".") || /^[A-Z]/.test(tag))) continue;
    if (tag === "Fragment" && !fragmentBound) continue;
    candidates.push({ start: element.start, end: element.end });
  }
  return candidates;
}

/**
 * This preview's marker nonce, derived from the build id so the workspace
 * fingerprint does not change between two plans of the same preview.
 */
export function astroPreviewMarkerNonce(buildId: string): string {
  // Two FNV-1a passes with different offsets: 64 bits of disambiguation.
  const fnv = (text: string, offset: number) => {
    let hash = offset >>> 0;
    for (let index = 0; index < text.length; index++) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return hash.toString(16).padStart(8, "0");
  };
  return `${fnv(`morph-preview:${buildId}`, 0x811c9dc5)}${fnv(`marker:${buildId}`, 0x050c5d1f)}`;
}

/**
 * The Vite plugin, as source text for the preview integration. Runs in the
 * container with the workspace's toolchain; `fs`, `path`, `crypto` (Node's),
 * `workspaceRoot` and `loadMagicString` (returns the `magic-string` class as
 * the `astro` package resolves it) are defined by the integration around it.
 *
 * MagicString is loaded when the dev server starts (`buildStart`) and before
 * the first annotation, outside the error handling that leaves a file
 * unannotated: if it cannot be loaded the preview fails with
 * `ASTRO_PREVIEW_LOCATE_NO_SOURCE_MAP`, never runs without a map.
 */
export function astroPreviewLocatePluginSource(nonce: string): string {
  if (!/^[0-9a-f]{16}$/.test(nonce)) throw new Error("Invalid marker nonce.");
  return `(() => {
  let MagicString = null;
  const requireMagicString = () => {
    if (MagicString) return MagicString;
    let loaded;
    try {
      loaded = loadMagicString();
    } catch (error) {
      throw new Error("ASTRO_PREVIEW_LOCATE_NO_SOURCE_MAP: magic-string could not be loaded through the astro package, so the preview locate plugin cannot map its edits: " + (error instanceof Error ? error.message : String(error)));
    }
    if (typeof loaded !== "function") {
      throw new Error("ASTRO_PREVIEW_LOCATE_NO_SOURCE_MAP: magic-string, loaded through the astro package, exports no MagicString class.");
    }
    MagicString = loaded;
    return MagicString;
  };
  const NONCE = ${JSON.stringify(nonce)};
  const RULE = ${ASTRO_BOUNDARY_RULE_VERSION};
  const ALIAS = ${JSON.stringify(astroPreviewBoundaryAlias(nonce))};
  const ALIAS_IMPORT = "import { Fragment as " + ALIAS + " } from " + ${JSON.stringify(JSON.stringify(ASTRO_COMPILER_RUNTIME_MODULE))} + ";";
  const MAX_OFFSET = ${ASTRO_BOUNDARY_MAX_OFFSET};
  const RESERVED_ATTRIBUTES = new Set(["data-morph-loc", "data-morph-loc-v", "data-morph-loc-s"]);
  const SKIPPED_ELEMENTS = new Set(["script", "style", "slot", "head"]);
  const fnv32 = ${astroPreviewSourceHash.toString()};
  const topLevelBindingNames = ${astroTopLevelBindingNames.toString()};
  const boundaryCandidates = ${astroBoundaryCandidates.toString()};
  const sha256 = (text) => crypto.createHash("sha256").update(text, "utf8").digest("hex");
  const lineStarts = (source) => {
    const starts = [0];
    for (let index = 0; index < source.length; index++) {
      if (source.charCodeAt(index) === 10) starts.push(index + 1);
    }
    return starts;
  };
  const lineColumn = (starts, offset) => {
    let low = 0;
    let high = starts.length - 1;
    while (low < high) {
      const mid = (low + high + 1) >> 1;
      if (starts[mid] <= offset) low = mid;
      else high = mid - 1;
    }
    return { line: low + 1, column: offset - starts[low] + 1 };
  };
  const elementName = (node) => {
    const name = node.openingElement && node.openingElement.name;
    if (!name) return null;
    if (name.type === "JSXIdentifier") return name.name;
    if (name.type === "JSXMemberExpression") return "member";
    return null;
  };
  const attributeNamed = (node, wanted) =>
    (node.openingElement.attributes || []).find(
      (attribute) =>
        attribute.type === "JSXAttribute" &&
        attribute.name &&
        (attribute.name.name === wanted ||
          (attribute.name.type === "JSXNamespacedName" &&
            attribute.name.namespace.name + ":" + attribute.name.name.name === wanted)),
    );
  // Where the alias import goes: on its own line before the closing fence,
  // or, without a frontmatter, in a new one at the top. Null when the
  // compiler's frontmatter range does not end in a fence.
  const aliasImportEdit = (ast, source) => {
    const frontmatter = ast.frontmatter;
    if (!frontmatter || !(frontmatter.end > 0)) {
      return { at: 0, end: 0, order: -1, text: "---\\n" + ALIAS_IMPORT + "\\n---\\n" };
    }
    const at = frontmatter.end - 3;
    if (source.slice(at, frontmatter.end) !== "---") return null;
    const lineBreak = source[at - 1] === "\\n" ? "" : "\\n";
    return { at, end: at, order: -1, text: lineBreak + ALIAS_IMPORT + "\\n" };
  };

  // The annotated copy and the source map of its edits back to the file
  // \`sourceId\` names, or null for a file the compiler cannot parse.
  function annotate(parse, source, relativePath, sourceId) {
    const { ast, diagnostics } = parse(source);
    if ((diagnostics || []).some((diagnostic) => diagnostic.severity === "error" || diagnostic.severity === 1)) {
      return null;
    }
    const starts = lineStarts(source);
    const sourceHash = fnv32(source);
    const sourceDigest = sha256(source);
    const location = JSON.stringify(relativePath).slice(1, -1).replace(/"/g, "&quot;");
    const boundNames = topLevelBindingNames(
      (ast.frontmatter && ast.frontmatter.program && ast.frontmatter.program.body) || [],
    );
    const fragmentBound = boundNames.includes("Fragment");
    // The author's own Fragment is a component; the built-in one keeps being
    // located like a host element, as before.
    const isComponent = (name) =>
      name === "member" || (name !== null && /^[A-Z]/.test(name) && (name !== "Fragment" || fragmentBound));
    const edits = [];
    const components = [];
    const visit = (node, inChildren, insideHead) => {
      if (Array.isArray(node)) {
        for (const child of node) visit(child, inChildren, insideHead);
        return;
      }
      if (!node || typeof node !== "object") return;
      let childHead = insideHead;
      if (node.type === "JSXElement") {
        const name = elementName(node);
        if (name === "head") childHead = true;
        if (isComponent(name)) {
          const tagNode = node.openingElement.name;
          components.push({
            start: node.start,
            end: node.end,
            tag: name === "member" ? source.slice(tagNode.start, tagNode.end) : name,
            slotted: Boolean(attributeNamed(node, "slot")),
            inChildren,
          });
        } else if (name && name !== "member" && !SKIPPED_ELEMENTS.has(name) && !insideHead) {
          for (const attribute of node.openingElement.attributes || []) {
            if (attribute.type === "JSXAttribute" && attribute.name && RESERVED_ATTRIBUTES.has(attribute.name.name)) {
              let from = attribute.start;
              while (from > 0 && /\\s/.test(source[from - 1])) from--;
              // Applied before the insertion at the same offset (the tag
              // name's end), which would otherwise be the text it removes.
              edits.push({ at: from, end: attribute.end, order: 4, text: "" });
            }
          }
          const { line, column } = lineColumn(starts, node.openingElement.start);
          edits.push({
            at: node.openingElement.name.end,
            end: node.openingElement.name.end,
            order: 3,
            text:
              ' data-morph-loc="' + location + ":" + line + ":" + column +
              '" data-morph-loc-v="' + sourceHash + '" data-morph-loc-s="' + sourceDigest + '"',
          });
        }
      }
      for (const [key, value] of Object.entries(node)) {
        if (key === "frontmatter" || !value || typeof value !== "object") continue;
        visit(value, key === "children", childHead);
      }
    };
    visit(ast.body, true, false);
    const importEdit =
      relativePath.startsWith("src/pages/") && components.length > 0 && !source.includes(ALIAS)
        ? aliasImportEdit(ast, source)
        : null;
    if (importEdit) {
      const wanted = new Set(boundaryCandidates(components, boundNames).map((range) => range.start + ":" + range.end));
      let marked = 0;
      for (const component of components) {
        if (!wanted.has(component.start + ":" + component.end) || component.end > MAX_OFFSET) continue;
        const id = NONCE + ":" + RULE + ":" + sourceDigest + ":" + component.start + ":" + component.end;
        const open = "<" + ALIAS + ' set:html={"<!--morph:s2 ' + id + '-->"} />';
        const close = "<" + ALIAS + ' set:html={"<!--/morph:s2 ' + id + '-->"} />';
        edits.push({ at: component.start, end: component.start, order: 1, text: component.inChildren ? open : "<>" + open });
        edits.push({ at: component.end, end: component.end, order: 0, text: component.inChildren ? close : close + "</>" });
        marked++;
      }
      if (marked > 0) edits.push(importEdit);
    }
    // Every edit is on the unmodified source's offsets, applied through one
    // MagicString so its map follows each of them. Removals first; then, at
    // one offset, insertions in ascending order, each appended after the
    // last: the alias import (order -1), a closing marker (0), an opening
    // one (1), a location (3), which reads ...A<close><open>B..., the text
    // the descending string splice before it produced byte for byte.
    const text = new MagicString(source);
    for (const edit of edits) if (edit.end > edit.at) text.remove(edit.at, edit.end);
    const inserts = edits.filter((edit) => edit.text !== "").sort((a, b) => a.at - b.at || a.order - b.order);
    for (const edit of inserts) text.appendLeft(edit.at, edit.text);
    return {
      code: text.toString(),
      map: text.generateMap({ hires: true, source: sourceId, includeContent: true }),
    };
  }

  let compiler = null;
  return {
    name: "morph:astro-preview-locate",
    enforce: "pre",
    buildStart() {
      requireMagicString();
    },
    async load(id) {
      if (id.includes("?") || !id.endsWith(".astro")) return null;
      const relative = path.relative(workspaceRoot, id);
      if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) return null;
      const segments = relative.split(path.sep);
      if (segments[0] !== "src" || segments.includes("node_modules")) return null;
      requireMagicString();
      let source;
      try {
        source = await fs.promises.readFile(id, "utf8");
      } catch {
        return null;
      }
      try {
        compiler ??= await import("@astrojs/compiler-rs");
        // { code, map }: Vite starts the module's map chain with this map,
        // so Astro's compile map composes onto the author's file.
        return annotate(compiler.parse, source, segments.join("/"), id);
      } catch {
        // The preview still runs unannotated; Astro reports its own errors.
        return null;
      }
    },
  };
})()`;
}
