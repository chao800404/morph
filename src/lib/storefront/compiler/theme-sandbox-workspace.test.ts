// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import {
  materializeThemeSandboxWorkspace,
  prepareThemeSandboxWorkspace,
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
  };
};

describe("laying out the workspace a Theme is served from", () => {
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
    expect(written.get("/workspace/src/morph/preview-content.ts")).toContain(
      'heading":"Stored draft',
    );
    expect(written.get("/workspace/vite.config.ts")).toContain(
      'name: "morph-preview-content"',
    );
    expect(written.get("/workspace/vite.config.ts")).toContain(
      'normalizedResolved.includes("/node_modules/.vite/")',
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
