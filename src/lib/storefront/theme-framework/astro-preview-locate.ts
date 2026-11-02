/**
 * Source locations and section boundary candidates for an Astro Live Preview
 * (L1.5a, docs/astro-theme-plan.md 3.6.2).
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
 *   (`astroPreviewSourceHash`);
 * - boundary comments around each component call, emitted through
 *   `<Fragment set:html>` because compiler-rs drops plain comments inside a
 *   component's slot content. Their text is fixed-format platform data only:
 *   `morph:s <nonce>:<source hash>:<n>`. The nonce tells this preview's
 *   markers apart from text an author wrote in advance; the page can read it,
 *   so it is not a credential and a boundary is never a confirmed binding.
 *
 * Every position is computed on the unmodified source and all edits are
 * applied in one pass, so an insertion never shifts a later location
 * (experiment 3 found exactly that when the passes were chained).
 *
 * Astro compiles `.astro` in its own early transform, so this runs at `load`.
 * Only module ids without a query are handled: Astro serves a file's style and
 * script sub-requests from the compile of that same module.
 */

/** Fixed-format boundary marker text, without the comment delimiters. */
export const ASTRO_PREVIEW_BOUNDARY_MARKER =
  /^(\/?)morph:s ([0-9a-f]{16}):([0-9a-f]{8}):(\d{1,6})$/;

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
 * container with the workspace's toolchain; `workspaceRoot` is defined by the
 * integration around it.
 */
export function astroPreviewLocatePluginSource(nonce: string): string {
  if (!/^[0-9a-f]{16}$/.test(nonce)) throw new Error("Invalid marker nonce.");
  return `(() => {
  const NONCE = ${JSON.stringify(nonce)};
  const SKIPPED_ELEMENTS = new Set(["script", "style", "slot", "head"]);
  const fnv32 = ${astroPreviewSourceHash.toString()};
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
  const isComponent = (name) =>
    name === "member" || (name !== null && /^[A-Z]/.test(name) && name !== "Fragment");
  const attributeNamed = (node, wanted) =>
    (node.openingElement.attributes || []).find(
      (attribute) =>
        attribute.type === "JSXAttribute" &&
        attribute.name &&
        (attribute.name.name === wanted ||
          (attribute.name.type === "JSXNamespacedName" &&
            attribute.name.namespace.name + ":" + attribute.name.name.name === wanted)),
    );

  function annotate(parse, source, relativePath) {
    const { ast, diagnostics } = parse(source);
    if ((diagnostics || []).some((diagnostic) => diagnostic.severity === "error" || diagnostic.severity === 1)) {
      return null;
    }
    const starts = lineStarts(source);
    const sourceHash = fnv32(source);
    const location = JSON.stringify(relativePath).slice(1, -1).replace(/"/g, "&quot;");
    const edits = [];
    let boundaryCount = 0;
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
          if (!attributeNamed(node, "slot")) {
            const marker = NONCE + ":" + sourceHash + ":" + boundaryCount++;
            const open = '<Fragment set:html={"<!--morph:s ' + marker + '-->"} />';
            const close = '<Fragment set:html={"<!--/morph:s ' + marker + '-->"} />';
            edits.push({ at: node.start, end: node.start, order: 1, text: inChildren ? open : "<>" + open });
            edits.push({ at: node.end, end: node.end, order: 0, text: inChildren ? close : close + "</>" });
          }
        } else if (name && name !== "member" && !SKIPPED_ELEMENTS.has(name) && !insideHead) {
          for (const attribute of node.openingElement.attributes || []) {
            if (
              attribute.type === "JSXAttribute" &&
              attribute.name &&
              (attribute.name.name === "data-morph-loc" || attribute.name.name === "data-morph-loc-v")
            ) {
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
            text: ' data-morph-loc="' + location + ":" + line + ":" + column + '" data-morph-loc-v="' + sourceHash + '"',
          });
        }
      }
      for (const [key, value] of Object.entries(node)) {
        if (key === "frontmatter" || !value || typeof value !== "object") continue;
        visit(value, key === "children", childHead);
      }
    };
    visit(ast.body, true, false);
    // Descending, so earlier offsets stay valid. At one offset an opening
    // marker goes in before a closing one, which reads ...A<close><open>B...
    edits.sort((a, b) => b.at - a.at || b.order - a.order);
    let out = source;
    for (const edit of edits) out = out.slice(0, edit.at) + edit.text + out.slice(edit.end);
    return out;
  }

  let compiler = null;
  return {
    name: "morph:astro-preview-locate",
    enforce: "pre",
    async load(id) {
      if (id.includes("?") || !id.endsWith(".astro")) return null;
      const relative = path.relative(workspaceRoot, id);
      if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) return null;
      const segments = relative.split(path.sep);
      if (segments[0] !== "src" || segments.includes("node_modules")) return null;
      let source;
      try {
        source = await fs.promises.readFile(id, "utf8");
      } catch {
        return null;
      }
      try {
        compiler ??= await import("@astrojs/compiler-rs");
        return annotate(compiler.parse, source, segments.join("/"));
      } catch {
        // The preview still runs unannotated; Astro reports its own errors.
        return null;
      }
    },
  };
})()`;
}
