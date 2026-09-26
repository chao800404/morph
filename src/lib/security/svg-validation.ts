import parseCss from "css-tree/parser";
import walkCss from "css-tree/walker";
import { SaxesParser, type SaxesTagNS } from "saxes";

/**
 * Whether an SVG file is safe to store and serve as it is — decided by
 * parsing it, never by searching its text, and never by rewriting it.
 *
 * A file that passes is kept byte for byte: what an author uploads or a
 * project brings in is what the site serves, and its digest stays the one
 * the author has. A file that fails is refused with the reason, so the
 * author can fix the original. Nothing is "cleaned".
 *
 * The rules, over a strict XML parse (a file that is not well-formed XML is
 * refused, not guessed at):
 * - one `<svg>` root in the SVG namespace; no DOCTYPE but the W3C SVG one,
 *   and never an internal subset, so no entities; no processing instruction
 *   but the XML declaration;
 * - elements from an allowlist of drawing elements. Script, foreign content,
 *   links, fonts, cursors and anything unknown are refused. Elements in the
 *   namespaces drawing tools write their bookkeeping in (Inkscape, Illustrator,
 *   RDF metadata, …) are allowed because nothing renders them; any other
 *   namespace — XHTML above all — is refused;
 * - no event handler attribute, in any case; no `xml:base`;
 * - a reference (`href`, `xlink:href`) names something in the same file
 *   (`#id`), except that `<image>` and `<feImage>` may embed a raster image
 *   as a `data:` URL;
 * - CSS — `<style>`, the `style` attribute, and any attribute value holding
 *   `url(` — is parsed: `@import` is refused, and every `url()` must name
 *   something in the same file;
 * - an animation may not target a reference or an event handler.
 *
 * This decides what may be stored. What a browser may do with a stored SVG
 * is limited separately, by the isolation headers every SVG response
 * carries (`theme-svg-isolation.ts`); neither replaces the other.
 */

/** Bumped whenever the rules change, so a stored verdict names the rules it passed. */
export const SVG_VALIDATOR_VERSION = 1;

export type SvgRefusal =
  | "not-utf8"
  | "not-xml"
  | "not-svg"
  | "doctype"
  | "processing-instruction"
  | "forbidden-element"
  | "foreign-namespace"
  | "event-handler"
  | "external-reference"
  | "unsafe-css"
  | "unsafe-animation";

export type SvgValidation =
  | Readonly<{ ok: true; validatorVersion: number }>
  | Readonly<{
      ok: false;
      reason: SvgRefusal;
      /** What was found, for the author: an element, attribute or value. */
      detail: string;
      line: number | null;
      validatorVersion: number;
    }>;

const SVG_NS = "http://www.w3.org/2000/svg";
const XLINK_NS = "http://www.w3.org/1999/xlink";
const XML_NS = "http://www.w3.org/XML/1998/namespace";
const XMLNS_NS = "http://www.w3.org/2000/xmlns/";

/** Namespaces drawing tools keep their own, never-rendered data in. */
const INERT_NAMESPACES = new Set([
  "http://www.w3.org/1999/02/22-rdf-syntax-ns#",
  "http://creativecommons.org/ns#",
  "http://web.resource.org/cc/",
  "http://purl.org/dc/elements/1.1/",
  "http://purl.org/dc/terms/",
  "http://sodipodi.sourceforge.net/DTD/sodipodi-0.dtd",
  "http://inkscape.sourceforge.net/DTD/sodipodi-0.dtd",
  "http://www.inkscape.org/namespaces/inkscape",
  "http://www.bohemiancoding.com/sketch/ns",
  "http://www.serif.com/",
  "http://ns.adobe.com/AdobeIllustrator/10.0/",
  "http://ns.adobe.com/AdobeSVGViewerExtensions/3.0/",
  "http://ns.adobe.com/Extensibility/1.0/",
  "http://ns.adobe.com/Flows/1.0/",
  "http://ns.adobe.com/GenericCustomNamespace/1.0/",
  "http://ns.adobe.com/Graphs/1.0/",
  "http://ns.adobe.com/ImageReplacement/1.0/",
  "http://ns.adobe.com/SaveForWeb/1.0/",
  "http://ns.adobe.com/Variables/1.0/",
  "http://ns.adobe.com/xap/1.0/",
]);

const ALLOWED_ELEMENTS = new Set([
  "svg",
  "g",
  "defs",
  "symbol",
  "use",
  "switch",
  "view",
  "title",
  "desc",
  "metadata",
  "style",
  "path",
  "rect",
  "circle",
  "ellipse",
  "line",
  "polyline",
  "polygon",
  "text",
  "tspan",
  "textPath",
  "linearGradient",
  "radialGradient",
  "stop",
  "pattern",
  "clipPath",
  "mask",
  "marker",
  "image",
  "filter",
  "feBlend",
  "feColorMatrix",
  "feComponentTransfer",
  "feComposite",
  "feConvolveMatrix",
  "feDiffuseLighting",
  "feDisplacementMap",
  "feDistantLight",
  "feDropShadow",
  "feFlood",
  "feFuncA",
  "feFuncB",
  "feFuncG",
  "feFuncR",
  "feGaussianBlur",
  "feImage",
  "feMerge",
  "feMergeNode",
  "feMorphology",
  "feOffset",
  "fePointLight",
  "feSpecularLighting",
  "feSpotLight",
  "feTile",
  "feTurbulence",
  "animate",
  "animateMotion",
  "animateTransform",
  "set",
  "mpath",
]);

const ANIMATIONS = new Set([
  "animate",
  "animateMotion",
  "animateTransform",
  "set",
]);
/** Elements that may embed a raster image instead of naming a fragment. */
const RASTER_EMBEDDERS = new Set(["image", "feImage"]);
const EMBEDDABLE_RASTER =
  /^data:image\/(?:png|jpe?g|gif|webp)(?:;[a-z0-9=.+-]+)*,/i;
const FRAGMENT = /^#[^\s#]*$/;
/**
 * The DOCTYPE the SVG 1.0 and 1.1 specifications give, by its public and
 * system identifiers, and nothing else: no internal subset.
 */
const STANDARD_SVG_DOCTYPE =
  /^\s*svg\s+PUBLIC\s+"-\/\/W3C\/\/DTD SVG (?:1\.0|1\.1(?: Tiny| Basic)?)\/\/EN"\s+"http:\/\/www\.w3\.org\/(?:TR\/2001\/REC-SVG-20010904\/DTD\/svg10\.dtd|Graphics\/SVG\/1\.1\/DTD\/svg11(?:-tiny|-basic)?\.dtd)"\s*$/;

class Refused extends Error {
  constructor(
    readonly reason: SvgRefusal,
    readonly detail: string,
  ) {
    super(`${reason}: ${detail}`);
  }
}

/** Every `url()` in a piece of CSS names a fragment, and nothing is imported. */
function checkCss(
  source: string,
  context: "stylesheet" | "declarationList" | "value",
  where: string,
) {
  let failed: string | null = null;
  const ast = parseCss(source, {
    context,
    onParseError: (error) => {
      failed ??= error.message;
    },
  });
  if (failed) throw new Refused("unsafe-css", `${where}: ${failed}`);
  walkCss(ast, (node) => {
    if (node.type === "Atrule" && node.name.toLowerCase() === "import") {
      throw new Refused("unsafe-css", `${where}: @import`);
    }
    if (node.type === "Url" && !FRAGMENT.test(node.value.trim())) {
      throw new Refused("external-reference", `${where}: url(${node.value})`);
    }
    if (
      node.type === "Declaration" &&
      /^(?:behavior|-moz-binding)$/i.test(node.property)
    ) {
      throw new Refused("unsafe-css", `${where}: ${node.property}`);
    }
  });
}

function checkElement(tag: SaxesTagNS, insideInert: boolean) {
  const where = `<${tag.name}>`;
  if (tag.uri === SVG_NS) {
    if (!ALLOWED_ELEMENTS.has(tag.local)) {
      throw new Refused("forbidden-element", where);
    }
  } else if (!INERT_NAMESPACES.has(tag.uri)) {
    throw new Refused(
      "foreign-namespace",
      `${where} in ${tag.uri || "no namespace"}`,
    );
  }

  for (const attribute of Object.values(tag.attributes)) {
    const name = attribute.name;
    const local = attribute.local.toLowerCase();
    const value = attribute.value;
    const at = `${where} ${name}`;

    if (
      attribute.uri === XMLNS_NS ||
      (attribute.prefix === "" && attribute.local === "xmlns")
    ) {
      continue;
    }
    if (local.startsWith("on")) throw new Refused("event-handler", at);
    if (attribute.uri === XML_NS && local === "base") {
      throw new Refused("external-reference", at);
    }
    const isReference =
      local === "href" && (attribute.uri === "" || attribute.uri === XLINK_NS);
    if (isReference) {
      const target = value.trim();
      const raster =
        tag.uri === SVG_NS &&
        RASTER_EMBEDDERS.has(tag.local) &&
        EMBEDDABLE_RASTER.test(target);
      if (!FRAGMENT.test(target) && !raster) {
        throw new Refused(
          "external-reference",
          `${at}="${target.slice(0, 80)}"`,
        );
      }
      continue;
    }
    // An attribute in another namespace is ignored by the renderer; what
    // could act — an event handler, a reference — is judged by its local
    // name above whatever its namespace, so it needs no rule of its own.
    if (
      tag.uri === SVG_NS &&
      ANIMATIONS.has(tag.local) &&
      local === "attributename"
    ) {
      const animated = value
        .trim()
        .toLowerCase()
        .replace(/^xlink:/, "");
      if (animated === "href" || animated.startsWith("on")) {
        throw new Refused("unsafe-animation", `${at}="${value}"`);
      }
    }
    if (local === "style" && attribute.uri === "") {
      checkCss(value, "declarationList", at);
    } else if (/url\s*\(/i.test(value) && !insideInert) {
      checkCss(value, "value", at);
    }
  }
}

export function validateSvg(bytes: Uint8Array): SvgValidation {
  const refuse = (
    reason: SvgRefusal,
    detail: string,
    line: number | null,
  ): SvgValidation => ({
    ok: false,
    reason,
    detail,
    line,
    validatorVersion: SVG_VALIDATOR_VERSION,
  });

  let source: string;
  try {
    source = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return refuse("not-utf8", "The file is not UTF-8 text.", null);
  }

  const parser = new SaxesParser({ xmlns: true, position: true });
  /** Open elements, innermost last: whether each is in an inert namespace. */
  const inert: boolean[] = [];
  const styleText: string[] = [];
  let styleDepth = -1;
  let sawRoot = false;
  let rootIsSvg = false;

  parser.on("doctype", (doctype) => {
    // Graphviz and older Illustrator exports name the W3C SVG DTD. That
    // alone defines nothing — browsers never fetch it — so it is accepted;
    // an internal subset, where entities are declared, never is.
    if (!STANDARD_SVG_DOCTYPE.test(doctype)) {
      throw new Refused("doctype", `<!DOCTYPE${doctype.slice(0, 80)}>`);
    }
  });
  parser.on("processinginstruction", (pi) => {
    throw new Refused("processing-instruction", `<?${pi.target} …?>`);
  });
  parser.on("opentag", (tag) => {
    const ns = tag as SaxesTagNS;
    if (!sawRoot) {
      sawRoot = true;
      rootIsSvg = ns.uri === SVG_NS && ns.local === "svg";
      if (!rootIsSvg) {
        throw new Refused(
          "not-svg",
          `The root is <${ns.name}>${ns.uri === SVG_NS ? "" : ` in ${ns.uri || "no namespace"} (an SVG file declares xmlns="${SVG_NS}")`}.`,
        );
      }
    }
    const insideInert = inert.some(Boolean);
    checkElement(ns, insideInert);
    inert.push(ns.uri !== SVG_NS);
    if (ns.uri === SVG_NS && ns.local === "style") {
      styleDepth = inert.length;
      styleText.length = 0;
    }
  });
  parser.on("text", (text) => {
    if (styleDepth === inert.length) styleText.push(text);
  });
  parser.on("cdata", (text) => {
    if (styleDepth === inert.length) styleText.push(text);
  });
  parser.on("closetag", () => {
    if (styleDepth === inert.length) {
      checkCss(styleText.join(""), "stylesheet", "<style>");
      styleDepth = -1;
    }
    inert.pop();
  });
  parser.on("error", (error) => {
    throw new Refused("not-xml", error.message);
  });

  try {
    parser.write(source).close();
  } catch (error) {
    const line = parser.line || null;
    if (error instanceof Refused)
      return refuse(error.reason, error.detail, line);
    return refuse(
      "not-xml",
      error instanceof Error ? error.message : String(error),
      line,
    );
  }
  if (!rootIsSvg)
    return refuse("not-svg", "The file has no <svg> element.", null);
  return { ok: true, validatorVersion: SVG_VALIDATOR_VERSION };
}

/** A sentence for an author, naming what to change in the original file. */
export function describeSvgRefusal(
  result: Extract<SvgValidation, { ok: false }>,
): string {
  const where = result.line ? ` (line ${result.line})` : "";
  const what: Record<SvgRefusal, string> = {
    "not-utf8": "The file is not UTF-8 text",
    "not-xml": "The file is not well-formed XML",
    "not-svg": "The file is not an SVG document",
    doctype: "SVG with a DOCTYPE is not accepted",
    "processing-instruction": "Processing instructions are not accepted",
    "forbidden-element": "This element is not allowed in an SVG here",
    "foreign-namespace": "Content from another XML namespace is not allowed",
    "event-handler": "Event handler attributes are not allowed",
    "external-reference": "Only references within the same file are allowed",
    "unsafe-css": "This CSS is not allowed in an SVG here",
    "unsafe-animation": "An animation may not change a link or event handler",
  };
  return `${what[result.reason]}${where}: ${result.detail}. Edit the original file and upload it again.`;
}
