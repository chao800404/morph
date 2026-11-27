/**
 * The differential check for the B1 taint pass: on every shared fixture, the
 * analysis must be at least as strict as it was at 51ad77b (the base of the
 * destructuring-taint fix). The base results are frozen in
 * `provenance-taint-baseline-51ad77b.json`, produced once by running 51ad77b's
 * `theme-content-provenance.ts` over exactly these fixtures. It is a baseline,
 * not an expectation: the per-case expectations stay handwritten.
 *
 * "At least as strict" means: every field the head claims, the base claimed;
 * and every path a base taint affects, a head taint affects too (probed at
 * the taint's own path, each of its ancestors and one child below it).
 */
import {
  ASTRO_B1_SAMPLES,
  DESTRUCTURE_TAINT_CASES,
  START_FIXTURE,
  destructureAstroSource,
  destructureStartFiles,
} from "./astro-b1-samples";
import { B1_INTEGRATION_CASES } from "./binding-acceptance-b1-cases";
import {
  BAS_HERO_PATH,
  BAS_HERO_SOURCE,
  basRouteSource,
} from "./binding-acceptance-cases";
import { livePreviewPlatformFiles } from "./live-preview-render";

type SourceFile = Readonly<{ path: string; content: string }>;

export type StartDifferentialFixture = Readonly<{
  id: string;
  files: readonly SourceFile[];
  routeFile: string;
}>;

export type AstroDifferentialFixture = Readonly<{
  id: string;
  routeFile: string;
  source: string;
  extraFiles: readonly SourceFile[];
}>;

/** One fixture's result: sorted taints and each instance's sorted claims. */
export type DifferentialResult = Readonly<{
  taints: readonly string[];
  instances: readonly Readonly<{ name: string; claims: readonly string[] }>[];
}>;

export type DifferentialBaseline = Readonly<{
  base: string;
  start: Readonly<Record<string, DifferentialResult>>;
  astro: Readonly<Record<string, DifferentialResult>>;
}>;

const startRouteOf = (routeFile: string) =>
  routeFile.replace("src/pages/", "src/routes/").replace(/\.astro$/, ".tsx");

export function startDifferentialFixtures(): StartDifferentialFixture[] {
  const fixtures: StartDifferentialFixture[] = [];
  for (const testCase of B1_INTEGRATION_CASES) {
    for (const spelling of ["content", "loader"] as const) {
      fixtures.push({
        id: `bas:${testCase.id}:${spelling}`,
        routeFile: testCase.routeFile,
        files: [
          ...livePreviewPlatformFiles(),
          { path: BAS_HERO_PATH, content: BAS_HERO_SOURCE },
          {
            path: testCase.routeFile,
            content: basRouteSource(testCase, spelling),
          },
        ],
      });
    }
  }
  for (const sample of ASTRO_B1_SAMPLES) {
    if (!sample.twin) continue;
    const routeFile = startRouteOf(sample.routeFile);
    fixtures.push({
      id: `twin:${sample.id}`,
      routeFile,
      files: [...START_FIXTURE, { path: routeFile, content: sample.twin }],
    });
  }
  for (const testCase of DESTRUCTURE_TAINT_CASES) {
    const routeFile = "src/routes/index.tsx";
    fixtures.push({
      id: `destructure:${testCase.id}`,
      routeFile,
      files: destructureStartFiles(testCase, routeFile),
    });
  }
  return fixtures;
}

export function astroDifferentialFixtures(): AstroDifferentialFixture[] {
  const fixtures: AstroDifferentialFixture[] = [];
  for (const sample of ASTRO_B1_SAMPLES) {
    if (sample.expected === "refused") continue;
    fixtures.push({
      id: `sample:${sample.id}`,
      routeFile: sample.routeFile,
      source: sample.source,
      extraFiles: [],
    });
  }
  for (const testCase of DESTRUCTURE_TAINT_CASES) {
    fixtures.push({
      id: `destructure:${testCase.id}`,
      routeFile: "src/pages/index.astro",
      source: destructureAstroSource(testCase),
      extraFiles: testCase.extraFiles ?? [],
    });
  }
  return fixtures;
}

type AnalysisLike = Readonly<{
  taints: readonly string[];
  instances: readonly Readonly<{
    componentName: string;
    claims: Readonly<
      Record<string, Readonly<{ kind: string; slot?: string; field?: string }>>
    >;
  }>[];
}>;

export function differentialResult(analysis: AnalysisLike): DifferentialResult {
  return {
    taints: [...analysis.taints].sort(),
    instances: analysis.instances.map((instance) => ({
      name: instance.componentName,
      claims: Object.values(instance.claims)
        .flatMap((claim) =>
          claim.kind === "claim" ? [`${claim.slot}.${claim.field}`] : [],
        )
        .sort(),
    })),
  };
}

/**
 * Whether a taint set affects a claim at `root` / `path`. Mirrors the
 * documented taint semantics (`set`: at, above or below; `in`: strictly
 * below or above; `root:*`: everything), written independently of the
 * production matcher.
 */
function affects(
  taints: readonly string[],
  root: string,
  path: readonly string[],
): boolean {
  for (const key of taints) {
    if (key === `${root}:*`) return true;
    const match = /^(set|in)\|([^:]+):(.*)$/.exec(key);
    if (!match || match[2] !== root) continue;
    const prefix = match[3] === "" ? [] : match[3]!.split(".");
    const shorter = Math.min(prefix.length, path.length);
    if (
      prefix.slice(0, shorter).join("\u0000") !==
      path.slice(0, shorter).join("\u0000")
    )
      continue;
    if (match[1] === "set" || prefix.length !== path.length) return true;
  }
  return false;
}

/** Why `head` is narrower than `base`, or null when it is not. */
export function narrowerThanBase(
  head: DifferentialResult,
  base: DifferentialResult,
): string | null {
  if (head.instances.length !== base.instances.length) {
    return `instances ${head.instances.length} != base ${base.instances.length}`;
  }
  for (const [index, instance] of head.instances.entries()) {
    const before = base.instances[index]!;
    if (instance.name !== before.name) {
      return `instance ${index} is ${instance.name}, base ${before.name}`;
    }
    for (const claim of instance.claims) {
      if (!before.claims.includes(claim)) {
        return `${instance.name} claims ${claim}; base did not`;
      }
    }
  }
  for (const key of base.taints) {
    const match = /^(?:(?:set|in)\|)?([^:]+):(.*)$/.exec(key);
    if (!match) continue;
    const root = match[1]!;
    const rest = match[2]!;
    const path = rest === "*" || rest === "" ? [] : rest.split(".");
    const probes = [
      ...path.map((_, end) => path.slice(0, end)),
      path,
      [...path, "\u0001child"],
      ...(rest === "*" ? [["\u0001other"]] : []),
    ];
    for (const probe of probes) {
      if (
        affects(base.taints, root, probe) &&
        !affects(head.taints, root, probe)
      ) {
        return `base taint ${key} affects ${root}:${probe.join(".")}; head does not`;
      }
    }
  }
  return null;
}
