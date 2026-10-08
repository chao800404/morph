// @vitest-environment node
import fs from "node:fs/promises";
import { expect, it, vi } from "vitest";
import { STARTER_THEME_FILES } from "../starter-theme-files";
import { LocalViteThemeBuildRunner } from "./local-vite-theme-build-runner";
import type { ThemeBuildRunnerInput } from "./theme-build-runner.types";
import { START_TOOLCHAIN } from "./sandbox-toolchain.test-support";

function nativeInput(): ThemeBuildRunnerInput {
  return {
    buildId: "native-prerender",
    storefrontId: "store",
    themeId: "theme",
    sourceRevisionId: "source",
    revisionNumber: 1,
    entry: "src/routes/index.tsx",
    inputHash: "a".repeat(64),
    compilerId: "tailwind-v4-build",
    compilerVersion: "4.1.17",
    toolchainId: START_TOOLCHAIN.id,
    files: [
      ...STARTER_THEME_FILES,
      {
        path: "src/routes/landing.tsx",
        content: `import { createFileRoute } from '@tanstack/react-router'; export const Route = createFileRoute('/landing')({ loader: () => ({ title: 'native-prerender-sentinel' }), component: () => <h1>{Route.useLoaderData().title}</h1> });`,
      },
    ],
    contentSnapshot: {
      publicationId: "pub",
      storefrontId: "store",
      themeId: "theme",
      documents: [
        {
          item: {
            id: "item",
            publicationId: "pub",
            itemType: "template",
            contentId: "page",
            revisionId: "revision",
            metadata: { routePath: "/landing" },
          },
          document: {
            version: 1,
            sections: [],
            renderPolicy: { mode: "ssg" },
          },
        },
      ],
    },
  };
}

it(
  "builds actual native SSG HTML through the platform-owned Cloudflare configuration",
  { timeout: 240_000 },
  async () => {
    const result = await new LocalViteThemeBuildRunner({
      maxDurationMs: 200_000,
    }).run(nativeInput());
    if (!result.success) throw new Error(result.errorMessage);
    const html = result.artifacts.find(
      (file) => file.path === "runtime/client/landing/index.html",
    );
    expect(html).toBeDefined();
    const text =
      typeof html!.content === "string"
        ? html!.content
        : new TextDecoder().decode(html!.content);
    expect(text).toContain("<h1>native-prerender-sentinel</h1>");
    expect(
      result.artifacts.some(
        (file) => file.path === "runtime/client/index.html",
      ),
    ).toBe(false);
  },
);

it.each(["::1", "127.0.0.1"])(
  "renders sealed CMS fields through a %s preview without shipping the snapshot",
  { timeout: 240_000 },
  async (previewHost) => {
    const input = nativeInput();
    input.contentSnapshot!.documents[0]!.document.sections = [
      {
        id: "prerender-field",
        type: "hero",
        enabled: true,
        props: { title: "sealed-content-sentinel" },
      },
    ];
    input.contentSnapshot!.documents.push({
      item: {
        id: "shell",
        publicationId: "pub",
        itemType: "template",
        contentId: "layout",
        revisionId: "layout-rev",
        metadata: { templateType: "layout" },
      },
      document: {
        version: 1,
        sections: [
          {
            id: "frozen-shell",
            type: "header",
            enabled: true,
            props: { title: "sealed-shell-sentinel" },
          },
        ],
      },
    });
    // Override only the platform-generated fixture config, not Theme source.
    // Explicit listeners make CI/local DNS ordering irrelevant to this test.
    const writeFile = fs.writeFile.bind(fs);
    const fixtureConfig = vi
      .spyOn(fs, "writeFile")
      .mockImplementation(async (file, data, options) => {
        if (
          typeof file === "string" &&
          file.endsWith("/vite.config.ts") &&
          typeof data === "string"
        ) {
          expect(data).toContain("  server: {");
          data = data.replace(
            "  server: {",
            `  preview: { host: ${JSON.stringify(previewHost)} },\n  server: {`,
          );
        }
        return writeFile(file, data, options);
      });
    let result;
    try {
      result = await new LocalViteThemeBuildRunner({
        maxDurationMs: 200_000,
      }).run({
        ...input,
        buildId: "native-prerender-content",
        files: input.files.map((file) =>
          file.path === "src/routes/landing.tsx"
            ? {
                ...file,
                content: `import { createFileRoute } from '@tanstack/react-router'; import { content } from '../morph/content'; export const Route = createFileRoute('/landing')({ component: () => <><h1>{String(content('prerender-field').title || 'WRONG_DEFAULT')}</h1><p>{String(content('frozen-shell').title || 'WRONG_SHELL')}</p></> });`,
              }
            : file,
        ),
      });
    } finally {
      fixtureConfig.mockRestore();
    }
    if (!result.success) throw new Error(result.errorMessage);
    const html = result.artifacts.find(
      (file) => file.path === "runtime/client/landing/index.html",
    );
    expect(html?.content).toContain("<h1>sealed-content-sentinel</h1>");
    expect(html?.content).not.toContain("WRONG_DEFAULT");
    expect(html?.content).toContain("<p>sealed-shell-sentinel</p>");
    expect(
      result.artifacts.some((file) => file.path.includes("prerender-content")),
    ).toBe(false);
    const server = result.artifacts
      .filter((file) => file.path.startsWith("runtime/server/"))
      .map((file) => String(file.content))
      .join("\n");
    expect(server).not.toContain("sealed-content-sentinel");
    expect(server).not.toContain("sealed-shell-sentinel");
  },
);

it(
  "fails the build when native prerender cannot render the selected page",
  { timeout: 240_000 },
  async () => {
    const input = nativeInput();
    const result = await new LocalViteThemeBuildRunner({
      maxDurationMs: 200_000,
    }).run({
      ...input,
      buildId: "native-prerender-error",
      files: input.files.map((file) =>
        file.path === "src/routes/landing.tsx"
          ? {
              ...file,
              content: `import { createFileRoute } from '@tanstack/react-router'; export const Route = createFileRoute('/landing')({ loader: () => { throw new Error('prerender-fixture-error'); }, component: () => <h1>Wrong success</h1> });`,
            }
          : file,
      ),
    });
    expect(result.success).toBe(false);
    if (!result.success)
      expect(result.errorMessage).toContain("Failed to fetch /landing");
  },
);
