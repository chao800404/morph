/**
 * Render-mode evidence Theme files (handoff/2026-11-28/start-render-modes-audit.md,
 * "Codex review — adopted", item 1), written beside an unchanged Starter 32
 * workspace: its root route, layout and content module stay the shipped ones.
 *
 * One test route per TanStack Start render mode, each reading its own Page
 * Document the Starter 32 way and through a loader:
 *
 * - `/rm-ssr`: full SSR (no `ssr` option);
 * - `/rm-off`: `ssr: false`;
 * - `/rm-data`: `ssr: "data-only"`;
 * - `/rm-fn`: an `ssr()` function, which renders on the client when the URL
 *   asks for `?render=client` and on the server otherwise (search, not path
 *   params: a Page Document belongs to one static path, see
 *   theme-template-routes.ts, so a param route would read no Document);
 * - `/rm-defer`: full SSR with a controlled `<Await>` whose deferred value is
 *   the page's content, read through `morph.pages.get` once the test releases
 *   it (`POST /api/rm-release`).
 *
 * Every route has four sections, each a component of its own with a text
 * default no Document holds:
 *
 * - `rm<mode>shown` / `rm<mode>hidden`: read with `content()` and guarded with
 *   `isSectionHidden()`, as the Starter's own home is;
 * - `rm<mode>loadshown` / `rm<mode>loadhidden`: read from the route's loader
 *   data (`morph.pages.get` in a `createServerFn`), as member reads of the
 *   page local at the call site (the classifier's H2 shape; a spread of a
 *   destructured slot is refused as unsupported-shape). On `/rm-defer` they
 *   are rendered inside `<Await>` once the deferred value resolves, from the
 *   root's content (see `renderModeDeferReadRoute` for why).
 *
 * Stored as strings and compiled only by the Theme toolchain, like the other
 * compatibility fixtures in this directory.
 */
import type { NativeCompatFile } from "./native-compat-theme";

export const RENDER_MODES = ["ssr", "off", "data", "fn", "defer"] as const;
export type RenderMode = (typeof RENDER_MODES)[number];

export const RENDER_MODE_KINDS = [
  "shown",
  "hidden",
  "loadshown",
  "loadhidden",
] as const;
export type RenderModeKind = (typeof RENDER_MODE_KINDS)[number];

/** The route's `ssr` option as written in its source. */
const SSR_OPTION: Record<RenderMode, string | null> = {
  ssr: null,
  off: "ssr: false,",
  data: 'ssr: "data-only",',
  fn: 'ssr: ({ search }) =>\n    search.status === "success" &&\n    (search.value as { render?: unknown }).render === "client"\n      ? false\n      : true,',
  defer: null,
};

export const renderModePath = (mode: RenderMode) => `/rm-${mode}`;
export const renderModeRouteFile = (mode: RenderMode) =>
  `src/routes/rm-${mode}.tsx`;
export const renderModeSlot = (mode: RenderMode, kind: RenderModeKind) =>
  `rm${mode}${kind}`;
/** A component default no Document holds: seen only if defaults rendered. */
export const renderModeDefault = (mode: RenderMode, kind: RenderModeKind) =>
  `rm-default-${mode}-${kind}`;
/** The component's own attribute: in a page only if it rendered. */
export const renderModeRendered = (mode: RenderMode, kind: RenderModeKind) =>
  `data-rm-section="${renderModeSlot(mode, kind)}"`;

const pascal = (value: string) => value[0]!.toUpperCase() + value.slice(1);
const KIND_NAMES: Record<RenderModeKind, string> = {
  shown: "Shown",
  hidden: "Hidden",
  loadshown: "LoadShown",
  loadhidden: "LoadHidden",
};
export const renderModeComponent = (mode: RenderMode, kind: RenderModeKind) =>
  `Rm${pascal(mode)}${KIND_NAMES[kind]}`;

function componentSource(mode: RenderMode, kind: RenderModeKind) {
  const name = renderModeComponent(mode, kind);
  return `import type { ThemeContentFields } from "../morph/content-fields";

export const contentFields = {
  heading: { type: "text", label: "Heading", maxLength: 200 },
} as const satisfies ThemeContentFields;

export default function ${name}({ heading = ${JSON.stringify(renderModeDefault(mode, kind))} }: { heading?: string }) {
  return (
    <section ${renderModeRendered(mode, kind)}>
      <h2>{heading}</h2>
    </section>
  );
}
`;
}

function routeSource(mode: RenderMode) {
  const path = renderModePath(mode);
  const page = `${pascal(mode)}Page`;
  const slot = (kind: RenderModeKind) => renderModeSlot(mode, kind);
  const component = (kind: RenderModeKind) => renderModeComponent(mode, kind);
  const imports = RENDER_MODE_KINDS.map(
    (kind) => `import ${component(kind)} from "../components/${component(kind)}";`,
  ).join("\n");
  const guarded = `      {!isSectionHidden("${slot("shown")}") && <${component("shown")} {...content("${slot("shown")}")} />}
      {!isSectionHidden("${slot("hidden")}") && <${component("hidden")} {...content("${slot("hidden")}")} />}`;
  if (mode === "defer") {
    return `import { Await, createFileRoute } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { content, isSectionHidden } from "../morph/content";
import { held } from "../rm/held";
${imports}

const readHeld = createServerFn({ method: "GET" }).handler(() => ({
  shell: "rm-defer-shell",
  released: held().then(() => "rm-defer-released"),
}));

export const Route = createFileRoute("${path}")({
  loader: () => readHeld(),
  component: ${page},
});

function ${page}() {
  const data = Route.useLoaderData();
  return (
    <main data-rm-page="${mode}">
      <p data-rm-defer-shell="">{data.shell}</p>
${guarded}
      <Await promise={data.released} fallback={<p data-rm-defer-pending="">rm-defer-pending</p>}>
        {(released) => <DeferredSections released={released} />}
      </Await>
    </main>
  );
}

function DeferredSections({ released }: { released: string }) {
  return (
    <div data-rm-defer-resolved={released}>
      {!isSectionHidden("${slot("loadshown")}") && <${component("loadshown")} {...content("${slot("loadshown")}")} />}
      {!isSectionHidden("${slot("loadhidden")}") && <${component("loadhidden")} {...content("${slot("loadhidden")}")} />}
    </div>
  );
}
`;
  }
  const ssr = SSR_OPTION[mode];
  return `import { createFileRoute } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { content, isSectionHidden, morph } from "../morph/content";
${imports}

const getPage = createServerFn().handler(() => morph.pages.get("${path}"));

export const Route = createFileRoute("${path}")({
${ssr ? `  ${ssr}\n` : ""}  loader: () => getPage(),
  component: ${page},
});

function ${page}() {
  const page = Route.useLoaderData();
  return (
    <main data-rm-page="${mode}">
${guarded}
      <${component("loadshown")} heading={page.${slot("loadshown")}?.heading} />
      <${component("loadhidden")} heading={page.${slot("loadhidden")}?.heading} />
    </main>
  );
}
`;
}

/**
 * The deferred value's gate. Module state of the Theme's server: a page
 * request's promise waits here until `POST /api/rm-release` lets every
 * waiting one go (GET or POST), or 20 s pass (so a failed run never holds a stream
 * open for good). It reads no content itself (a module that does would be a
 * reader the Hide proof has to follow); the route reads the page after it.
 */
const HELD_SOURCE = `const waiting = new Set<() => void>();

export function held() {
  return new Promise<void>((resolve) => {
    const release = () => {
      clearTimeout(timer);
      waiting.delete(release);
      resolve();
    };
    const timer = setTimeout(release, 20_000);
    waiting.add(release);
  });
}

export function releaseHeld(): number {
  const all = [...waiting];
  for (const release of all) release();
  return all.length;
}
`;

const RELEASE_ROUTE_SOURCE = `import { createFileRoute } from "@tanstack/react-router";
import { releaseHeld } from "../../rm/held";

export const Route = createFileRoute("/api/rm-release")({
  server: {
    handlers: {
      // GET too, so a second tab can release a document still streaming.
      GET: () => Response.json({ released: releaseHeld() }),
      POST: () => Response.json({ released: releaseHeld() }),
    },
  },
});
`;

/**
 * `/rm-defer` with its deferred value reading the page itself
 * (`morph.pages.get` after the gate) and the deferred sections rendered from
 * that value inside `<Await>`. Not in `RENDER_MODES_FILES`: the Hide proof
 * refuses it (theme-hide-render-modes.test.ts), and with it in the Theme no
 * section anywhere could be hidden, so the E2E fixture renders its deferred
 * sections from the root's content instead and the late read itself is
 * probed in workerd (packages/morph-sdk/start/streamed-read.workerd.test.ts).
 */
export function renderModeDeferReadRoute(): NativeCompatFile {
  const mode = "defer";
  const path = renderModePath(mode);
  const slot = (kind: RenderModeKind) => renderModeSlot(mode, kind);
  const component = (kind: RenderModeKind) => renderModeComponent(mode, kind);
  const imports = RENDER_MODE_KINDS.map(
    (kind) => `import ${component(kind)} from "../components/${component(kind)}";`,
  ).join("\n");
  return {
    path: renderModeRouteFile(mode),
    content: `import { Await, createFileRoute } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { content, isSectionHidden, morph } from "../morph/content";
import { held } from "../rm/held";
${imports}

const readHeld = createServerFn({ method: "GET" }).handler(() => ({
  page: held().then(() => morph.pages.get("${path}")),
}));

export const Route = createFileRoute("${path}")({
  loader: () => readHeld(),
  component: DeferPage,
});

function DeferPage() {
  const data = Route.useLoaderData();
  return (
    <main data-rm-page="${mode}">
      {!isSectionHidden("${slot("shown")}") && <${component("shown")} {...content("${slot("shown")}")} />}
      {!isSectionHidden("${slot("hidden")}") && <${component("hidden")} {...content("${slot("hidden")}")} />}
      <Await promise={data.page} fallback={<p data-rm-defer-pending="">rm-defer-pending</p>}>
        {(page) => (
          <div data-rm-defer-resolved="">
            <${component("loadshown")} {...page.${slot("loadshown")}} />
            <${component("loadhidden")} {...page.${slot("loadhidden")}} />
          </div>
        )}
      </Await>
    </main>
  );
}
`,
  };
}

export const RENDER_MODE_RELEASE_PATH = "/api/rm-release";

export const RENDER_MODES_FILES: readonly NativeCompatFile[] = [
  ...RENDER_MODES.flatMap((mode) =>
    RENDER_MODE_KINDS.map((kind) => ({
      path: `src/components/${renderModeComponent(mode, kind)}.tsx`,
      content: componentSource(mode, kind),
    })),
  ),
  ...RENDER_MODES.map((mode) => ({
    path: renderModeRouteFile(mode),
    content: routeSource(mode),
  })),
  { path: "src/rm/held.ts", content: HELD_SOURCE },
  { path: "src/routes/api/rm-release.ts", content: RELEASE_ROUTE_SOURCE },
];
