/**
 * Core's verification of an Astro component instance identity (M2 PR-I, P5;
 * design v2 §6, decisions D90/D91/D93).
 *
 * The preview names a component instance by a v2 boundary id,
 * `<nonce>:<rule>:<sha256 of the route file>:<start>:<end>`
 * (astro-preview-locate.ts), and the clicked element's file by its sha256
 * (`sourceDigest`, P6). Both come from a page that runs author code, so they
 * are claims. This module decides, from Core's own snapshot of one source
 * generation and Core's own analysis of it, which B1 instance a claim names,
 * or refuses it. It never guesses and never falls back to an ordinal or a
 * component name.
 *
 * What this does: it eliminates the known ordinal-mismatch mechanism (I2,
 * where a `<UI.Badge/>` the analysis does not count shifted every later
 * ordinal, and F3, a built-in `<Fragment>` counted as an instance): the key
 * is the instance's source range in the route file, checked against the
 * route's and the component file's full sha256. It is not a proof that a
 * write lands on the right Document field: the rest of the selection-to-write
 * chain is proven elsewhere (design v2 §3, U1–U8).
 *
 * Identity only (§8). Passing here grants nothing: authorisation, ownership
 * (`findEditorContext`), the source generation check, the B1 field claims and
 * `allowedFields`, and the Document CAS (`expectedDraftGeneration`) all still
 * apply, after this and unchanged. The `astro-identity-v2` capability is not
 * an input: Core verifies every identity, whatever the preview announced.
 *
 * Still to be built on this (not here):
 * - PR-D: the binding view serverFn returns `astroBindingViewIdentities` per
 *   instance (with ownership and the source generation read around it).
 * - PR-E: the Astro section write takes `AstroSectionWriteIdentityInput`,
 *   required for Astro and unused for Start, and calls
 *   `verifyAstroSectionWriteIdentity` inside the write transaction on the
 *   snapshot that transaction read, after ownership and before the field
 *   claims; plus the DAL tests of design v2 §8 (old format, swapped
 *   instances, stale component digest, no identity: each refused with the
 *   template's document, draft generation and revision count read back
 *   unchanged).
 */
import type { AstroParseTemplate } from "@morph/astro-parser-worker/contract";

import {
  normalizeThemeSourcePath,
  resolveThemeSourceImport,
} from "../ast/theme-content-binding";
import type {
  B1Instance,
  B1RouteAnalysis,
  B1SourceFile,
} from "../ast/theme-content-provenance";
import { parseThemeSourceLocation } from "../compiler/theme-source-location-plugin";
import {
  ASTRO_BOUNDARY_RULE_VERSION,
  astroBoundaryCandidates,
  astroTopLevelBindingNames,
  parseAstroInstanceIdentity,
  type AstroBoundaryElement,
  type AstroInstanceIdentity,
} from "../theme-framework/astro-preview-locate";
import type { AstroProjection } from "./astro-source-language";

// ------------------------------------------------------------------- types

/** An instance's identity as the binding view returns it (PR-D, C3). */
export type AstroBindingViewInstanceIdentity = Readonly<{
  identity: Readonly<{ rule: number; src: string; start: number; end: number }>;
  /** sha256 of the instance's component file in the same snapshot. */
  componentDigest: string;
}>;

/**
 * What an Astro section write carries (PR-E): the boundary id the selection
 * named, and the component file digest the selection was confirmed against.
 * Required for an Astro Theme; a Start write has neither.
 */
export type AstroSectionWriteIdentityInput = Readonly<{
  identity: string;
  componentDigest: string;
}>;

/**
 * One source generation as Core read it: every file of the Theme. The route
 * analysis below must be of exactly these contents.
 */
export type AstroIdentitySnapshot = Readonly<{
  files: readonly B1SourceFile[];
}>;

/** Core's own reading of one route file of that snapshot. */
export type AstroRouteIdentityInput = Readonly<{
  routeFile: string;
  /** The `template` answer `parseAstroTemplate` confirmed for the route. */
  template: AstroParseTemplate;
  /** `projectAstroTemplate` of the same source and answer. */
  projection: AstroProjection;
  /** `analyzeB1AstroRoute` over the same snapshot. */
  analysis: B1RouteAnalysis;
}>;

/**
 * Why an identity is refused, by class (plan v2 §6):
 *
 * temporarily unconfirmable (reload the preview, try again):
 * - `preview-identity-legacy`: no v2 id (an older preview or editor, or a
 *   malformed id);
 * - `preview-rule-mismatch`: a v2 id of another boundary rule;
 * - `source-stale`: the route's or the component file's digest is not the
 *   snapshot's (the preview shows another version);
 * - `preview-identity-mismatch`: same route version, but the range is not a
 *   boundary candidate (a native/Wasm disagreement, U1), or the write names
 *   another section than the instance's;
 * - `analysis-inconsistent`: the analysis handed in is not of this snapshot
 *   (a caller defect; refused, never repaired).
 *
 * capability limit (Code stays available):
 * - `no-instance`: a candidate that is not exactly one B1 instance whose
 *   component Core resolves itself (a member tag, a non-import binding such
 *   as `const Fragment = Hero`).
 */
export type AstroIdentityRefusalReason =
  | "preview-identity-legacy"
  | "preview-rule-mismatch"
  | "source-stale"
  | "preview-identity-mismatch"
  | "analysis-inconsistent"
  | "no-instance";

export type AstroIdentityRefusal = Readonly<{
  ok: false;
  class: "temporarily-unconfirmable" | "capability-limit";
  reason: AstroIdentityRefusalReason;
  detail: string;
}>;

/**
 * Why a confirmed instance still offers no Design selection; Code (L1.5a)
 * stays available in each case:
 * - `no-selection`: no clicked element was given;
 * - `cross-component`: the clicked element is in another file than the
 *   instance's component (a nested component, `slot=` content, the page);
 * - `no-source-digest`: the selection carries no `sourceDigest`.
 */
export type AstroDesignSelectionUnavailable =
  "no-selection" | "cross-component" | "no-source-digest";

export type AstroIdentityConfirmed = Readonly<{
  ok: true;
  identity: AstroInstanceIdentity;
  instance: B1Instance;
  /** sha256 of `instance.componentPath` in the snapshot. */
  componentDigest: string;
  /** Whether the clicked element may become a Design selection. */
  designSelection: Readonly<{
    componentPath: string;
    sourceDigest: string;
  }> | null;
  designSelectionUnavailable: AstroDesignSelectionUnavailable | null;
}>;

export type AstroIdentityVerification =
  AstroIdentityConfirmed | AstroIdentityRefusal;

const refuse = (
  reason: AstroIdentityRefusalReason,
  detail: string,
): AstroIdentityRefusal => ({
  ok: false,
  class:
    reason === "no-instance" ? "capability-limit" : "temporarily-unconfirmable",
  reason,
  detail,
});

// ------------------------------------------------------------------ inputs

/** sha256 of a text's UTF-8 bytes, lowercase hex: the plugin's `sha256`. */
export async function astroSourceDigest(text: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/** The template answer's elements, as the boundary rule reads them. */
export function astroTemplateBoundaryElements(
  answer: AstroParseTemplate,
): AstroBoundaryElement[] {
  const slotted = new Set<number>();
  for (const [element, kind, name] of answer.attributes) {
    if (kind !== "spread" && name === "slot") slotted.add(element);
  }
  return answer.elements.map(([start, end, tag], index) => ({
    start,
    end,
    tag: answer.tags[tag] ?? "",
    slotted: slotted.has(index),
  }));
}

type AnyNode = { type?: string; [key: string]: unknown };

/** The frontmatter's top-level statements in the projection. */
function frontmatterStatements(projection: AstroProjection): AnyNode[] {
  const body = (projection.ast as unknown as { program?: { body?: AnyNode[] } })
    .program?.body;
  return (body ?? []).filter(
    (statement) => !projection.synthetic.has(statement),
  );
}

// --------------------------------------------------------------- verifying

type Located = Readonly<{
  identity: AstroInstanceIdentity;
  instance: B1Instance;
  componentPath: string;
  componentDigest: string;
}>;

/**
 * Steps 1–6 of design v2 §6: the instance a boundary id names, with its
 * component file and that file's digest, or a refusal.
 */
async function locateInstance(
  marker: string | null | undefined,
  snapshot: AstroIdentitySnapshot,
  route: AstroRouteIdentityInput,
): Promise<Located | AstroIdentityRefusal> {
  // 1. Grammar.
  const identity = parseAstroInstanceIdentity(marker);
  if (!identity) {
    return refuse(
      "preview-identity-legacy",
      "the selection carries no v2 instance identity",
    );
  }
  // 2. Rule version.
  if (identity.rule !== ASTRO_BOUNDARY_RULE_VERSION) {
    return refuse(
      "preview-rule-mismatch",
      `boundary rule ${identity.rule}, Core applies ${ASTRO_BOUNDARY_RULE_VERSION}`,
    );
  }
  // 3. The route file's version, after checking that every input is of this
  // snapshot.
  const routeFile = normalizeThemeSourcePath(route.routeFile);
  const contentByPath = new Map(
    snapshot.files.map((file) => [
      normalizeThemeSourcePath(file.path),
      file.content,
    ]),
  );
  const routeSource = contentByPath.get(routeFile);
  if (
    routeSource === undefined ||
    route.projection.source !== routeSource ||
    route.template.mode !== "template" ||
    route.template.source.length !== routeSource.length ||
    normalizeThemeSourcePath(route.analysis.routeFile) !== routeFile
  ) {
    return refuse(
      "analysis-inconsistent",
      `the analysis handed in is not of ${routeFile} in this snapshot`,
    );
  }
  if (identity.src !== (await astroSourceDigest(routeSource))) {
    return refuse(
      "source-stale",
      `the preview's ${routeFile} is not the snapshot's version`,
    );
  }
  // 4. Exactly one boundary candidate of the shared rule.
  const statements = frontmatterStatements(route.projection);
  const boundNames = astroTopLevelBindingNames(statements);
  const elements = astroTemplateBoundaryElements(route.template);
  const candidates = astroBoundaryCandidates(elements, boundNames).filter(
    (candidate) =>
      candidate.start === identity.start && candidate.end === identity.end,
  );
  if (candidates.length !== 1) {
    return refuse(
      "preview-identity-mismatch",
      `${identity.start}-${identity.end} is not a boundary candidate of ${routeFile}`,
    );
  }
  // 5. Exactly one B1 instance at that range.
  const instances = route.analysis.instances.filter(
    (instance) =>
      instance.start === identity.start && instance.end === identity.end,
  );
  const instance = instances.length === 1 ? instances[0]! : null;
  if (!instance || instance.componentPath === null) {
    return refuse(
      "no-instance",
      `${identity.start}-${identity.end} is not one analysed component instance`,
    );
  }
  // 6. The component, by Core's own import resolution: the tag is a plain
  // identifier bound once at the frontmatter's top level, by a value import
  // of the component file itself, under the export the analysis records.
  const element = elements.find(
    (entry) => entry.start === identity.start && entry.end === identity.end,
  )!;
  const componentPath = normalizeThemeSourcePath(instance.componentPath);
  if (
    !componentImportMatches({
      tag: element.tag,
      boundNames,
      statements,
      routeFile,
      filePaths: new Set(contentByPath.keys()),
      componentPath,
      componentExport: instance.componentExport,
    })
  ) {
    return refuse(
      "no-instance",
      `${element.tag} at ${identity.start} does not resolve to ${componentPath} by a direct import`,
    );
  }
  const componentSource = contentByPath.get(componentPath);
  if (componentSource === undefined) {
    return refuse(
      "analysis-inconsistent",
      `${componentPath} is not in this snapshot`,
    );
  }
  return {
    identity,
    instance,
    componentPath,
    componentDigest: await astroSourceDigest(componentSource),
  };
}

function componentImportMatches(args: {
  tag: string;
  boundNames: readonly string[];
  statements: readonly AnyNode[];
  routeFile: string;
  filePaths: ReadonlySet<string>;
  componentPath: string;
  componentExport: string | null;
}): boolean {
  // Astro v1: a member tag (`UI.Badge`) is not resolved to a component file.
  if (!/^[A-Za-z_$][\w$]*$/.test(args.tag)) return false;
  if (args.boundNames.filter((name) => name === args.tag).length !== 1) {
    return false;
  }
  const matches: { source: string; exported: string }[] = [];
  for (const statement of args.statements) {
    if (
      statement.type !== "ImportDeclaration" ||
      statement.importKind === "type"
    )
      continue;
    const source = (statement.source as { value?: unknown } | undefined)?.value;
    if (typeof source !== "string") continue;
    for (const specifier of (statement.specifiers as AnyNode[]) ?? []) {
      const local = (specifier.local as { name?: unknown } | undefined)?.name;
      if (local !== args.tag || specifier.importKind === "type") continue;
      if (specifier.type === "ImportDefaultSpecifier") {
        matches.push({ source, exported: "default" });
      } else if (specifier.type === "ImportSpecifier") {
        const imported = specifier.imported as
          { name?: unknown; value?: unknown } | undefined;
        const name = imported?.name ?? imported?.value;
        if (typeof name === "string") matches.push({ source, exported: name });
      }
    }
  }
  if (matches.length !== 1) return false;
  const [only] = matches;
  return (
    resolveThemeSourceImport(args.routeFile, only!.source, args.filePaths) ===
      args.componentPath &&
    only!.exported === (args.componentExport ?? "default")
  );
}

/**
 * Steps 1–7: which instance a canvas selection names, and whether the
 * clicked element may become a Design selection (design v2 §6). `selection`
 * is the clicked element's `sourceLocation` and `sourceDigest`, as the
 * preview reported them.
 */
export async function verifyAstroInstanceIdentity(args: {
  marker: string | null | undefined;
  selection?: Readonly<{
    sourceLocation: string | null | undefined;
    sourceDigest: string | null | undefined;
  }> | null;
  snapshot: AstroIdentitySnapshot;
  route: AstroRouteIdentityInput;
}): Promise<AstroIdentityVerification> {
  const located = await locateInstance(args.marker, args.snapshot, args.route);
  if (!("instance" in located)) return located;
  const confirmed = (
    designSelection: AstroIdentityConfirmed["designSelection"],
    designSelectionUnavailable: AstroDesignSelectionUnavailable | null,
  ): AstroIdentityConfirmed => ({
    ok: true,
    identity: located.identity,
    instance: located.instance,
    componentDigest: located.componentDigest,
    designSelection,
    designSelectionUnavailable,
  });
  // 7. The clicked element: in the instance's component file, at the
  // snapshot's version of that file. Field-level selection additionally
  // needs a field element Core confirmed (PR-D/E), not decided here.
  if (!args.selection) return confirmed(null, "no-selection");
  const location = parseThemeSourceLocation(args.selection.sourceLocation);
  if (
    !location ||
    normalizeThemeSourcePath(location.filePath) !== located.componentPath
  ) {
    return confirmed(null, "cross-component");
  }
  const digest = args.selection.sourceDigest;
  if (typeof digest !== "string" || digest.length === 0) {
    return confirmed(null, "no-source-digest");
  }
  if (digest !== located.componentDigest) {
    return refuse(
      "source-stale",
      `the preview's ${located.componentPath} is not the snapshot's version`,
    );
  }
  return confirmed(
    { componentPath: located.componentPath, sourceDigest: digest },
    null,
  );
}

/**
 * Step 8, for the write path (PR-E calls it in the write transaction, on the
 * snapshot that transaction read): steps 1–6 again, the component digest the
 * selection was confirmed against, and the section the write names must be
 * the instance's. A write without an identity (an editor older than v2) is
 * `preview-identity-legacy`. Confirms identity only; every write guard after
 * it still applies.
 */
export async function verifyAstroSectionWriteIdentity(args: {
  input: AstroSectionWriteIdentityInput | null | undefined;
  sectionId: string;
  snapshot: AstroIdentitySnapshot;
  route: AstroRouteIdentityInput;
}): Promise<
  | Readonly<{
      ok: true;
      identity: AstroInstanceIdentity;
      instance: B1Instance;
    }>
  | AstroIdentityRefusal
> {
  const located = await locateInstance(
    args.input?.identity,
    args.snapshot,
    args.route,
  );
  if (!("instance" in located)) return located;
  if (args.input?.componentDigest !== located.componentDigest) {
    return refuse(
      "source-stale",
      `the selection's ${located.componentPath} is not the snapshot's version`,
    );
  }
  if (located.instance.section !== args.sectionId) {
    return refuse(
      "preview-identity-mismatch",
      `the instance at ${located.identity.start} is section ${String(located.instance.section)}, not ${args.sectionId}`,
    );
  }
  return { ok: true, identity: located.identity, instance: located.instance };
}

/**
 * The binding view's identities (PR-D): every boundary candidate of the
 * route that steps 4–6 confirm, keyed by B1 instance range. Candidates that
 * are not exactly one resolvable instance are left out (no Design selection;
 * Code stays).
 */
export async function astroBindingViewIdentities(
  snapshot: AstroIdentitySnapshot,
  route: AstroRouteIdentityInput,
): Promise<AstroBindingViewInstanceIdentity[]> {
  // The nonce names a preview, which the binding view has none of; Core
  // never reads it.
  const nonce = "0".repeat(16);
  const routeFile = normalizeThemeSourcePath(route.routeFile);
  const routeSource = snapshot.files.find(
    (file) => normalizeThemeSourcePath(file.path) === routeFile,
  )?.content;
  if (routeSource === undefined) return [];
  const src = await astroSourceDigest(routeSource);
  const candidates = astroBoundaryCandidates(
    astroTemplateBoundaryElements(route.template),
    astroTopLevelBindingNames(frontmatterStatements(route.projection)),
  );
  const out: AstroBindingViewInstanceIdentity[] = [];
  for (const { start, end } of candidates) {
    const located = await locateInstance(
      `${nonce}:${ASTRO_BOUNDARY_RULE_VERSION}:${src}:${start}:${end}`,
      snapshot,
      route,
    );
    if (!("instance" in located)) continue;
    out.push({
      identity: { rule: ASTRO_BOUNDARY_RULE_VERSION, src, start, end },
      componentDigest: located.componentDigest,
    });
  }
  return out;
}
