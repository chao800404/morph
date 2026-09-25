// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import {
  materializeThemeSandboxWorkspace,
  planThemeSandboxWorkspace,
  prepareThemeSandboxWorkspace,
  runWithConcurrency,
} from "./theme-sandbox-workspace";
import { DEFAULT_APPROVED_DEPENDENCIES } from "./sandbox-vite-theme-build-runner.types";

const CARD = `import type { ThemeContentFields } from "../morph/content-fields";

export const contentFields = {
  heading: { type: "text", label: "Heading" },
  items: {
    type: "array",
    label: "Items",
    fields: { title: { type: "text", label: "Title" } },
  },
} as const satisfies ThemeContentFields;

export default function Card({ heading, items = [] }) {
  return (
    <section>
      <h1>{heading}</h1>
      {items.map((item, index) => (
        <p key={item.id}>{item.title}</p>
      ))}
    </section>
  );
}
`;

const prepare = async (mode: "build" | "preview-server") => {
  const written = new Map<string, string>();
  const result = await prepareThemeSandboxWorkspace({
    session: {
      async mkdir() {},
      async writeFile(path, content) {
        written.set(path, String(content));
      },
    },
    files: [
      { path: "src/components/Card.tsx", content: CARD },
      {
        path: "src/pages/index.tsx",
        content: `import Card from "../components/Card";\nexport default () => <Card />;\n`,
      },
    ],
    entry: "src/pages/index.tsx",
    buildId: "workspace-test",
    approvedDependencies: new Set(DEFAULT_APPROVED_DEPENDENCIES),
    mode,
  });
  return {
    result,
    card: written.get("/workspace/src/components/Card.tsx") ?? "",
    viteConfig: written.get("/workspace/vite.config.ts") ?? "",
    indexHtml: written.get("/workspace/index.html") ?? "",
  };
};

describe("laying out the workspace a Theme is served from", () => {
  it("runs the preview's diagnostic script before either module graph", async () => {
    const { indexHtml } = await prepare("preview-server");
    const diagnostic = indexHtml.indexOf("morph:storefront-preview-diagnostic");
    expect(diagnostic).toBeGreaterThan(-1);
    expect(diagnostic).toBeLessThan(indexHtml.indexOf('src="/__entry.tsx"'));
    expect(diagnostic).toBeLessThan(
      indexHtml.indexOf('src="/src/morph/preview-bridge.ts"'),
    );
  });

  it("leaves the diagnostic script out of a build", async () => {
    const { indexHtml } = await prepare("build");
    expect(indexHtml).not.toContain("morph:storefront-preview-diagnostic");
  });

  it("removes regular files left by an older workspace plan", async () => {
    const deleted: string[] = [];
    const written: string[] = [];
    await materializeThemeSandboxWorkspace(
      {
        async mkdir() {},
        async writeFile(path) {
          written.push(path);
        },
        async listFiles() {
          return {
            success: true,
            files: [
              {
                absolutePath: "/workspace/src/routes/index.tsx",
                type: "file" as const,
              },
              {
                absolutePath: "/workspace/src/routes/deleted.tsx",
                type: "file" as const,
              },
              {
                absolutePath: "/workspace/.morph-preview-workspace.sha256",
                type: "file" as const,
              },
              {
                absolutePath: "/workspace/node_modules",
                type: "symlink" as const,
              },
              {
                absolutePath: "/workspace/node_modules/.vite/deps/react.js",
                type: "file" as const,
              },
              {
                absolutePath: "/workspace/src/routeTree.gen.ts",
                type: "file" as const,
              },
              {
                absolutePath: "/workspace/.vite/deps/chunk.js",
                type: "file" as const,
              },
            ],
          };
        },
        async deleteFile(path) {
          deleted.push(path);
        },
      },
      [
        {
          path: "/workspace/src/routes/index.tsx",
          content: "export default function Page() {}",
        },
      ],
    );

    expect(deleted).toEqual(["/workspace/src/routes/deleted.tsx"]);
    expect(written).toEqual(["/workspace/src/routes/index.tsx"]);
  });

  it("tolerates FileNotFoundError when a stale file was already removed", async () => {
    const deleted: string[] = [];
    const written: string[] = [];

    await materializeThemeSandboxWorkspace(
      {
        async mkdir() {},
        async writeFile(path) {
          written.push(path);
        },
        async listFiles() {
          return {
            success: true,
            files: [
              {
                absolutePath: "/workspace/src/routes/deleted.tsx",
                type: "file" as const,
              },
            ],
          };
        },
        async deleteFile(path) {
          deleted.push(path);
          const error = new Error(`File not found: ${path}`);
          error.name = "FileNotFoundError";
          throw error;
        },
      },
      [
        {
          path: "/workspace/src/routes/index.tsx",
          content: "export default function Page() {}",
        },
      ],
    );

    expect(deleted).toEqual(["/workspace/src/routes/deleted.tsx"]);
    expect(written).toEqual(["/workspace/src/routes/index.tsx"]);
  });

  it("refuses to materialize when it cannot see what is already there", async () => {
    // Reconciliation is the only thing standing between a warm sandbox and a
    // deleted component that still satisfies an old import. A listing that
    // failed says nothing about what is on disk, and carrying on would write
    // the new plan over an unknown workspace while reporting success.
    const deleted: string[] = [];
    const written: string[] = [];

    await expect(
      materializeThemeSandboxWorkspace(
        {
          async mkdir() {},
          async writeFile(path) {
            written.push(path);
          },
          async listFiles() {
            return { success: false, files: [] };
          },
          async deleteFile(path) {
            deleted.push(path);
          },
        },
        [
          {
            path: "/workspace/src/routes/index.tsx",
            content: "export default function Page() {}",
          },
        ],
      ),
    ).rejects.toThrow(/existing Theme preview workspace/i);

    expect(deleted).toEqual([]);
    expect(written).toEqual([]);
  });

  it("materializes for a writer that cannot reconcile at all", async () => {
    // A build lays out a fresh container, so it has no prior plan to remove
    // and no reason to carry the two calls that would do it. Requiring them
    // would make the build path fail on a capability it does not need.
    const written: string[] = [];

    await materializeThemeSandboxWorkspace(
      {
        async mkdir() {},
        async writeFile(path) {
          written.push(path);
        },
      },
      [
        {
          path: "/workspace/src/routes/index.tsx",
          content: "export default function Page() {}",
        },
      ],
    );

    expect(written).toEqual(["/workspace/src/routes/index.tsx"]);
  });

  it("creates each directory once and bounds independent file writes", async () => {
    const directories: string[] = [];
    const written: string[] = [];
    let activeWrites = 0;
    let maximumActiveWrites = 0;
    const result = await prepareThemeSandboxWorkspace({
      session: {
        async mkdir(path) {
          directories.push(path);
        },
        async writeFile(path) {
          written.push(path);
          activeWrites += 1;
          maximumActiveWrites = Math.max(maximumActiveWrites, activeWrites);
          await new Promise((resolve) => setTimeout(resolve, 1));
          activeWrites -= 1;
        },
      },
      files: [
        { path: "src/components/Card.tsx", content: CARD },
        {
          path: "src/components/SecondCard.tsx",
          content: CARD.replace("Card", "SecondCard"),
        },
        {
          path: "src/pages/index.tsx",
          content: `import Card from "../components/Card";\nexport default () => <Card />;\n`,
        },
      ],
      entry: "src/pages/index.tsx",
      buildId: "concurrency-test",
      approvedDependencies: new Set(DEFAULT_APPROVED_DEPENDENCIES),
      mode: "preview-server",
    });

    expect(result.ok).toBe(true);
    expect(new Set(directories).size).toBe(directories.length);
    expect(new Set(written).size).toBe(written.length);
    expect(maximumActiveWrites).toBeGreaterThan(1);
    expect(maximumActiveWrites).toBeLessThanOrEqual(8);
  });

  it("validates the complete plan before it touches the workspace", async () => {
    const mkdir = vi.fn(async () => {});
    const writeFile = vi.fn(async () => {});
    const result = await prepareThemeSandboxWorkspace({
      session: { mkdir, writeFile },
      files: [
        {
          path: "src/pages/index.tsx",
          content: `export default () => <p>Invalid config</p>;\n`,
        },
        {
          path: "tsconfig.json",
          content: JSON.stringify({ extends: "@company/tsconfig" }),
        },
      ],
      entry: "src/pages/index.tsx",
      buildId: "invalid-plan-test",
      approvedDependencies: new Set(DEFAULT_APPROVED_DEPENDENCIES),
      mode: "preview-server",
    });

    expect(result.ok).toBe(false);
    expect(mkdir).not.toHaveBeenCalled();
    expect(writeFile).not.toHaveBeenCalled();
  });

  it("keeps a repeated row addressable even though the declaration is lifted", async () => {
    // The two passes disagree if they run the other way round: lifting the
    // declaration first leaves nothing exported to read, every row field is
    // judged undeclared, and nothing repeated stays editable.
    const { card, result } = await prepare("preview-server");

    expect(card).toContain(
      "data-storefront-field-path={`items.${index}.title`}",
    );
    expect(card).toContain('data-storefront-field="title"');
    expect(card).toContain("data-storefront-item-id={item?.id}");

    // And the lift still happened, so the module is a Fast Refresh boundary.
    expect(card).not.toContain("export const contentFields");
    expect(card).toContain("const contentFields = {");
    expect(result.ok && result.hoistedContentFields).toContain(
      "src/components/Card.tsx",
    );
  });

  it("records where each annotated element sits in the author's own file", async () => {
    const { card } = await prepare("preview-server");
    // Derived from the author's own file rather than hardcoded, because that
    // is exactly the claim: the position survives the lift, which blanks its
    // keyword in place rather than moving a byte.
    const lines = CARD.split("\n");
    const line = lines.findIndex((text) => text.includes("<h1>")) + 1;
    // The `<` itself, one-based: the same position the parsed source keys the
    // element by, which is what lets the Inspector look it up.
    const column = lines[line - 1]!.indexOf("<h1>") + 1;
    expect(card).toContain(
      `data-morph-loc="src/components/Card.tsx:${line}:${column}"`,
    );
  });

  it("names the top-level field an element shows", async () => {
    const { card } = await prepare("preview-server");
    expect(card).toContain('data-storefront-field="heading"');
  });

  it("serves preview assets and HMR from the preview-only URL namespace", async () => {
    const { viteConfig } = await prepare("preview-server");

    expect(viteConfig).toContain("const isLivePreview = true");
    expect(viteConfig).toContain('"/__morph-theme-preview__/"');
    expect(viteConfig).toContain('? { path: "hmr" }');
    expect(viteConfig).toContain("? { usePolling: true, interval: 100 }");
    expect(viteConfig).toContain('name: "morph-preview-http-hmr"');
    expect(viteConfig).toContain('"/__morph-theme-preview__/_morph/hmr"');
    expect(viteConfig).toContain("__morphApplyViteHmrPayload");
  });

  it("leaves authored route modules for the generated preview entry to accept", async () => {
    const written = new Map<string, string>();
    const result = await prepareThemeSandboxWorkspace({
      session: {
        async mkdir() {},
        async writeFile(path, content) {
          written.set(path, String(content));
        },
      },
      files: [
        {
          path: "morph.theme.json",
          content: JSON.stringify({ router: { framework: "tanstack-start" } }),
        },
        {
          path: "src/router.tsx",
          content: "export function getRouter() { return null; }",
        },
        {
          path: "src/routes/__root.tsx",
          content: "export const Route = createRootRoute({});",
        },
        {
          path: "src/routes/index.tsx",
          content: 'export const Route = createFileRoute("/")({});',
        },
      ],
      entry: "src/routes/index.tsx",
      buildId: "route-hmr-test",
      approvedDependencies: new Set(DEFAULT_APPROVED_DEPENDENCIES),
      mode: "preview-server",
    });

    expect(result.ok).toBe(true);
    const viteConfig = written.get("/workspace/vite.config.ts") ?? "";
    expect(viteConfig).toContain("const previewRouteSourcePatterns = [");
    expect(viteConfig).toContain('"/workspace/src/routes/__root.tsx"');
    expect(viteConfig).toContain('"/workspace/src/routes/index.tsx"');
    expect(viteConfig).toContain("/\\/node_modules\\//");
    expect(viteConfig).toContain(
      "viteReact({ exclude: previewReactExcludePatterns })",
    );
  });

  it("serves authenticated draft content from inside the preview workspace", async () => {
    const written = new Map<string, string>();
    const result = await prepareThemeSandboxWorkspace({
      session: {
        async mkdir() {},
        async writeFile(path, content) {
          written.set(path, String(content));
        },
      },
      files: [
        {
          path: "src/pages/index.tsx",
          content: "export default () => <main />;\n",
        },
      ],
      entry: "src/pages/index.tsx",
      buildId: "preview-content-test",
      approvedDependencies: new Set(DEFAULT_APPROVED_DEPENDENCIES),
      mode: "preview-server",
      previewContent: {
        templates: {
          index: {
            slots: { hero: { heading: "Stored draft" } },
            hiddenSlots: [],
          },
        },
        pages: {},
      },
    });

    expect(result.ok).toBe(true);
    // The content travels as data: the module a page loads it from, and the
    // file the dev server's endpoint reads per request.
    expect(
      written.get("/workspace/src/morph/preview-content-snapshot.ts"),
    ).toContain('heading":"Stored draft');
    expect(written.get("/workspace/.morph-preview-content.json")).toContain(
      'heading":"Stored draft',
    );
    // Never in the code or the Vite config, so changing it changes neither.
    expect(written.get("/workspace/src/morph/preview-content.ts")).not.toContain(
      "Stored draft",
    );
    expect(written.get("/workspace/vite.config.ts")).not.toContain(
      "Stored draft",
    );
    expect(written.get("/workspace/vite.config.ts")).toContain(
      'name: "morph-preview-content"',
    );
    expect(written.get("/workspace/vite.config.ts")).toContain(
      'normalizedResolved.includes("/node_modules/.vite/")',
    );
  });

  it("names the container's roots in the config, where the toolchain runs there", async () => {
    const { viteConfig } = await prepare("preview-server");

    // Every path the generated config resolves at runtime is the container's.
    expect(viteConfig).toContain('root: "/workspace"');
    expect(viteConfig).toContain(
      'allow: ["/workspace","/opt/morph-toolchain/node_modules"]',
    );
    expect(viteConfig).toContain('path.relative("/workspace", resolved)');
    expect(viteConfig).toContain(
      'resolved = path.resolve("/workspace", source.slice(1))',
    );
    expect(viteConfig).toContain(
      'const importerDir = importer ? path.dirname(importer) : "/workspace";',
    );
    expect(viteConfig).toContain(
      '!normalizedResolved.startsWith("/workspace")',
    );
    expect(viteConfig).toContain(
      'source.startsWith("/@fs/opt/morph-toolchain/node_modules/")',
    );
    for (const outDir of ["runtime", "preview"]) {
      expect(viteConfig).toContain(`"/workspace/dist/${outDir}"`);
    }
  });

  it("puts a caller's host root in the config while plan paths stay the workspace's", async () => {
    // A root with a space and a quote: a filesystem path may contain both, and
    // the generated config is text that must survive either.
    const hostRoot = '/tmp/morph theme "quoted"/workspace';
    const toolchainRoot = "/repo/morph";
    const plan = planThemeSandboxWorkspace({
      files: [
        {
          path: "morph.theme.json",
          content: JSON.stringify({ router: { framework: "tanstack-start" } }),
        },
        {
          path: "src/router.tsx",
          content: "export function getRouter() { return null; }",
        },
        {
          path: "src/routes/__root.tsx",
          content: "export const Route = createRootRoute({});",
        },
        {
          path: "src/routes/index.tsx",
          content: 'export const Route = createFileRoute("/")({});',
        },
      ],
      entry: "src/routes/index.tsx",
      buildId: "host-root-test",
      approvedDependencies: new Set(DEFAULT_APPROVED_DEPENDENCIES),
      mode: "preview-server",
      hostWorkspaceRoot: hostRoot,
      toolchainRoot,
    });

    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    const configFile = plan.workspaceFiles.find(
      (file) => file.path === "/workspace/vite.config.ts",
    );
    const config =
      configFile && "content" in configFile ? configFile.content : "";
    // `JSON.stringify` is what a quote in a path has to travel through, so the
    // escaped form is the exact string the config is expected to contain.
    const root = JSON.stringify(hostRoot);

    expect(config).toContain(`root: ${root}`);
    expect(config).toContain(`path.relative(${root}, resolved)`);
    expect(config).toContain(`resolved = path.resolve(${root}, source.slice(1))`);
    expect(config).toContain(
      `const importerDir = importer ? path.dirname(importer) : ${root};`,
    );
    expect(config).toContain(`!normalizedResolved.startsWith(${root})`);
    expect(config).toContain(`${JSON.stringify(`${hostRoot}/dist/preview`)}`);
    expect(config).toContain(
      `allow: [${root},${JSON.stringify(`${toolchainRoot}/node_modules`)}]`,
    );
    expect(config).toContain(
      `source.startsWith(${JSON.stringify(`/@fs${toolchainRoot}/node_modules/`)})`,
    );
    // The route modules Vite must not treat as a Refresh boundary are named
    // where they really are, or the exclusion matches nothing.
    expect(config).toContain(`${JSON.stringify(`${hostRoot}/src/routes/index.tsx`)}`);
    // Aliases point into the real root too.
    expect(config).toMatch(/themeAliasDefinitions = \[/);
    expect(config).not.toContain('root: "/workspace"');

    // And the plan's own paths do not move: a writer is still what decides
    // where those land, which is why the local transport translates them.
    expect(config).not.toContain(`${hostRoot}/vite.config.ts`);
    expect(plan.workspaceFiles.map((file) => file.path)).toContain(
      "/workspace/vite.config.ts",
    );
  });

  it("leaves a build with the Theme exactly as the author wrote it", async () => {
    const { card, result, viteConfig } = await prepare("build");

    expect(card).toBe(CARD);
    expect(card).toContain("export const contentFields");
    expect(card).not.toContain("data-morph-loc");
    expect(card).not.toContain("data-storefront-field");
    expect(result.ok && result.hoistedContentFields).toEqual([]);
    expect(result.ok && result.annotatedElements).toEqual({});
    expect(viteConfig).toContain("const isLivePreview = false");
    expect(viteConfig).toContain("watch: isLivePreview");
  });
});

describe("what a build is given", () => {
  it("ships none of the editor's attributes, including hand-written ones", async () => {
    const { card, result } = await prepare("build");
    expect(card).not.toContain("data-storefront-field");
    expect(card).not.toContain("data-morph-loc");
    expect(result.ok && result.strippedEditorMarkers).toEqual({});
  });

  it("strips a marker the author wrote, and keeps their own attributes", async () => {
    const written = new Map<string, string>();
    const result = await prepareThemeSandboxWorkspace({
      session: {
        async mkdir() {},
        async writeFile(path, content) {
          written.set(path, String(content));
        },
      },
      files: [
        {
          path: "src/components/Marked.tsx",
          content: `export default function Marked({ heading }) {
  return <h1 data-storefront-field="heading" data-analytics-id="cta">{heading}</h1>;
}
`,
        },
        {
          path: "src/pages/index.tsx",
          content: `import Marked from "../components/Marked";\nexport default () => <Marked />;\n`,
        },
      ],
      entry: "src/pages/index.tsx",
      buildId: "strip-test",
      approvedDependencies: new Set(DEFAULT_APPROVED_DEPENDENCIES),
      mode: "build",
    });

    const marked = written.get("/workspace/src/components/Marked.tsx") ?? "";
    expect(marked).not.toContain("data-storefront-field");
    expect(marked).toContain('data-analytics-id="cta"');
    expect(result.ok && result.strippedEditorMarkers).toEqual({
      "src/components/Marked.tsx": 1,
    });
  });
});

describe("runWithConcurrency", () => {
  it("takes no item after a failure, and rejects only once the running ones finish", async () => {
    const started: number[] = [];
    const finished: number[] = [];
    let release!: () => void;
    const slow = new Promise<void>((resolve) => (release = resolve));

    const run = runWithConcurrency([1, 2, 3, 4, 5], 2, async (item) => {
      started.push(item);
      if (item === 1) await slow;
      if (item === 2) throw new Error("disk full");
      finished.push(item);
    });
    let settled = false;
    void run.catch(() => undefined).then(() => (settled = true));

    await new Promise((resolve) => setTimeout(resolve, 10));
    // Item 1 is still running, so the failure is not reported yet.
    expect(settled).toBe(false);
    release();

    await expect(run).rejects.toThrow("disk full");
    expect(started).toEqual([1, 2]);
    expect(finished).toEqual([1]);
  });
});
