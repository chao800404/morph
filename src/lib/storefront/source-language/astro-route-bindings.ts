/**
 * Core's reading of one Astro page for Design (M2 plan v2 §2.1 steps 2–5,
 * §5.1, §6): the parser's `template` answer for the page and every `.astro`
 * module it reaches, their projections, the Astro-profile B1 analysis, and
 * the instance identities Core confirms on that same snapshot.
 *
 * One reading for both users, so they cannot disagree:
 * - the read-only binding view (`storefrontThemeDal.readRouteBindings`,
 *   C3), which only shows what Core confirmed;
 * - the Astro section write (PR-E), which repeats the whole reading on the
 *   snapshot it writes against and trusts nothing the view returned.
 *
 * Fail closed. Every refusal carries the plan's class and reason code:
 * - `temporarily-unconfirmable` (A): the parser could not be asked or did
 *   not answer in the contract, or the source moved while it was read. The
 *   source is not at fault; retry or reload.
 * - `capability-limit` (B): legal source this version cannot handle (size,
 *   a fragment Babel cannot read, a dynamic route). Code stays available.
 * - `author-syntax` (C): the compiler reported diagnostics.
 * - `controlled-by-code` (D): the analysis read the page and found its
 *   content is decided by code (its diagnostics), the B1 meaning.
 * Nothing here falls back to the stored Document, a name or an ordinal.
 */
import type { AstroParseTemplate } from "@morph/astro-parser-worker/contract";

import {
  normalizeThemeSourcePath,
  resolveThemeSourceImport,
} from "../ast/theme-content-binding";
import {
  analyzeB1AstroRoute,
  type B1AstroRoute,
  type B1RouteAnalysis,
  type B1SourceFile,
} from "../ast/theme-content-provenance";
import { sourceSectionIdentity } from "../compiler/theme-route-sections";
import { ASTRO_BOUNDARY_RULE_VERSION } from "../theme-framework/astro-preview-locate";
import {
  astroBindingViewIdentities,
  astroSourceDigest,
  type AstroRouteIdentityInput,
} from "./astro-instance-identity";
import {
  parseAstroTemplate,
  type AstroParserBinding,
  type AstroParserFailureClass,
} from "./astro-parser-client";
import {
  projectAstroTemplate,
  type AstroProjection,
} from "./astro-source-language";

/** The four failure classes of plan v2 §6.2. */
export type AstroBindingFailureClass =
  AstroParserFailureClass | "controlled-by-code";

export type AstroBindingRefusal = Readonly<{
  ok: false;
  class: AstroBindingFailureClass;
  /** The plan's reason code (§6.2), e.g. `parser-busy`, `dynamic-route`. */
  reason: string;
  detail: string;
}>;

export const astroBindingRefusal = (
  klass: AstroBindingFailureClass,
  reason: string,
  detail: string,
): AstroBindingRefusal => ({ ok: false, class: klass, reason, detail });

export type AstroRouteReading = Readonly<{
  ok: true;
  route: B1AstroRoute;
  /** What the identity checks take: the route's own parse, projection and analysis. */
  identityInput: AstroRouteIdentityInput;
}>;

/** Specifiers of `import … from "x"`, `export … from "x"`, `import "x"`. */
const STATIC_SPECIFIER = /\b(?:from|import)\s*["']([^"'\n]+)["']/g;

/**
 * Every `.astro` module the page may reach, the page first. A textual scan
 * that over-approximates (every file it reaches is followed, whatever its
 * language), so a reachable `.astro` module is parsed here; one the scan
 * misses has no projection, and the analysis then taints every root rather
 * than reading it any other way.
 */
export function reachableAstroModules(
  routeFile: string,
  contentByPath: ReadonlyMap<string, string>,
): string[] {
  const filePaths = new Set(contentByPath.keys());
  const seen = new Set<string>([routeFile]);
  const queue = [routeFile];
  while (queue.length > 0) {
    const path = queue.shift()!;
    const text = contentByPath.get(path);
    if (text === undefined) continue;
    for (const match of text.matchAll(STATIC_SPECIFIER)) {
      const next = resolveThemeSourceImport(path, match[1]!, filePaths);
      if (next === null || seen.has(next)) continue;
      seen.add(next);
      queue.push(next);
    }
  }
  return [...seen].filter((path) => path.endsWith(".astro"));
}

/**
 * Reads one Astro page of one source snapshot: parses the page and every
 * `.astro` module it reaches (one at a time: the parser has one slot), then
 * projects and analyses them. `files` must be the whole snapshot Core read
 * for one source generation; the caller checks that generation around this.
 */
export async function readAstroRoute(args: {
  binding: AstroParserBinding | null | undefined;
  files: readonly B1SourceFile[];
  route: B1AstroRoute;
}): Promise<AstroRouteReading | AstroBindingRefusal> {
  const routeFile = normalizeThemeSourcePath(args.route.sourcePath);
  if (args.route.dynamic) {
    // Plan v2 §4 / Q6: the registry's `dynamic` alone decides; a dynamic
    // page has no Document of its own, so nothing on it is bound.
    return astroBindingRefusal(
      "capability-limit",
      "dynamic-route",
      `${args.route.path} has route parameters; Design edits fixed pages only`,
    );
  }
  const contentByPath = new Map<string, string>();
  for (const file of args.files) {
    const path = normalizeThemeSourcePath(file.path);
    if (contentByPath.has(path)) {
      return astroBindingRefusal(
        "temporarily-unconfirmable",
        "source-stale",
        `the snapshot names ${path} twice`,
      );
    }
    contentByPath.set(path, file.content);
  }
  if (!contentByPath.has(routeFile)) {
    return astroBindingRefusal(
      "temporarily-unconfirmable",
      "source-stale",
      `${routeFile} is not in the snapshot`,
    );
  }
  const projections = new Map<string, AstroProjection>();
  let routeTemplate: AstroParseTemplate | null = null;
  for (const path of reachableAstroModules(routeFile, contentByPath)) {
    const source = contentByPath.get(path)!;
    const outcome = await parseAstroTemplate(args.binding, source);
    if (outcome.status !== "confirmed") {
      return astroBindingRefusal(
        outcome.class,
        outcome.reason,
        `${path}: ${outcome.detail}`,
      );
    }
    const projection = projectAstroTemplate(source, outcome.result);
    if (!projection.ok) {
      return astroBindingRefusal(
        projection.class,
        projection.reason,
        `${path}: ${projection.detail}`,
      );
    }
    projections.set(path, projection);
    if (path === routeFile) routeTemplate = outcome.result;
  }
  const routeProjection = projections.get(routeFile);
  if (!routeTemplate || !routeProjection) {
    return astroBindingRefusal(
      "temporarily-unconfirmable",
      "parser-invalid-response",
      `${routeFile} has no parser answer`,
    );
  }
  const analysis: B1RouteAnalysis = analyzeB1AstroRoute({
    files: args.files,
    route: args.route,
    projections,
  });
  return {
    ok: true,
    route: args.route,
    identityInput: {
      routeFile,
      template: routeTemplate,
      projection: routeProjection,
      analysis,
    },
  };
}

/** One field an instance's call site proves comes from its section. */
export type AstroRouteBindingClaim = Readonly<{ slot: string; field: string }>;

/** One component instance Core confirmed on the page (plan v2 §2.1 step 5). */
export type AstroRouteBindingInstance = Readonly<{
  /** P5 identity: the route file's sha256 and the instance's range in it. */
  identity: Readonly<{ rule: number; src: string; start: number; end: number }>;
  /** sha256 of the component file in the same snapshot (P6). */
  componentDigest: string;
  componentPath: string;
  componentName: string;
  /** The Document section the instance renders, or null when unbound. */
  section: string | null;
  /** The ref and type a first write would store for the section. */
  componentRef: string;
  sectionType: string;
  /** Fields the component declares (`<Name>.fields.ts` or the manifest). */
  declaredFields: readonly string[];
  /** The declared fields this call site proves come from `section`. */
  claims: readonly AstroRouteBindingClaim[];
}>;

export type AstroRouteBindingStatus =
  | Readonly<{ kind: "confirmed" }>
  | Readonly<{
      kind: "refused";
      class: AstroBindingFailureClass;
      reason: string;
      detail: string;
    }>;

/**
 * The read-only binding view of one Astro page (C3). Only what Core
 * confirmed; a hint for the editor, never an input to a write: the write
 * reads the source again and checks everything itself.
 */
export type AstroRouteBindingsView = Readonly<{
  routePath: string;
  routeFile: string | null;
  /** The source generation this view was read at (both reads agreed). */
  sourceGeneration: number;
  /** sha256 of the route file in that generation, when it was read. */
  routeSourceDigest: string | null;
  boundaryRule: number;
  status: AstroRouteBindingStatus;
  instances: readonly AstroRouteBindingInstance[];
}>;

/** A view with no instances, for a refusal. */
export function refusedAstroRouteBindingsView(args: {
  routePath: string;
  routeFile: string | null;
  sourceGeneration: number;
  routeSourceDigest: string | null;
  refusal: AstroBindingRefusal;
}): AstroRouteBindingsView {
  return {
    routePath: args.routePath,
    routeFile: args.routeFile,
    sourceGeneration: args.sourceGeneration,
    routeSourceDigest: args.routeSourceDigest,
    boundaryRule: ASTRO_BOUNDARY_RULE_VERSION,
    status: {
      kind: "refused",
      class: args.refusal.class,
      reason: args.refusal.reason,
      detail: args.refusal.detail,
    },
    instances: [],
  };
}

/**
 * The binding view of a page Core read (`readAstroRoute`): every boundary
 * candidate whose identity Core confirms (`astroBindingViewIdentities`),
 * with the instance's section and the claims of its call site. Analysis
 * diagnostics refuse the whole page (D): the write would refuse every field
 * of it, so the view does not offer one.
 */
export async function astroRouteBindingsView(args: {
  routePath: string;
  sourceGeneration: number;
  files: readonly B1SourceFile[];
  reading: AstroRouteReading;
}): Promise<AstroRouteBindingsView> {
  const { identityInput } = args.reading;
  const routeSource = args.files.find(
    (file) => normalizeThemeSourcePath(file.path) === identityInput.routeFile,
  )?.content;
  const routeSourceDigest =
    routeSource === undefined ? null : await astroSourceDigest(routeSource);
  const base = {
    routePath: args.routePath,
    routeFile: identityInput.routeFile,
    sourceGeneration: args.sourceGeneration,
    routeSourceDigest,
    boundaryRule: ASTRO_BOUNDARY_RULE_VERSION,
  };
  const { analysis } = identityInput;
  if (analysis.diagnostics.length > 0) {
    return refusedAstroRouteBindingsView({
      ...base,
      refusal: astroBindingRefusal(
        "controlled-by-code",
        "analysis-diagnostics",
        analysis.diagnostics[0]!,
      ),
    });
  }
  const identities = await astroBindingViewIdentities(
    { files: args.files },
    identityInput,
  );
  const instances: AstroRouteBindingInstance[] = [];
  for (const { identity, componentDigest } of identities) {
    const instance = analysis.instances.find(
      (candidate) =>
        candidate.start === identity.start && candidate.end === identity.end,
    );
    if (!instance || instance.componentPath === null) continue;
    const componentPath = normalizeThemeSourcePath(instance.componentPath);
    const stored = sourceSectionIdentity({
      files: args.files,
      componentSourcePath: componentPath,
      componentExport: instance.componentExport,
      componentName: instance.componentName,
    });
    const claims: AstroRouteBindingClaim[] = [];
    for (const claim of Object.values(instance.claims)) {
      if (claim.kind !== "claim" || claim.slot !== instance.section) continue;
      claims.push({ slot: claim.slot, field: claim.field });
    }
    claims.sort((a, b) => a.field.localeCompare(b.field));
    instances.push({
      identity,
      componentDigest,
      componentPath,
      componentName: instance.componentName,
      section: instance.section,
      componentRef: stored.componentRef,
      sectionType: stored.sectionType,
      declaredFields: [...instance.declaredFields],
      claims,
    });
  }
  return { ...base, status: { kind: "confirmed" }, instances };
}
