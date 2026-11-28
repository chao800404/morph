// @vitest-environment node
import { describe, expect, it } from "vitest";
import { TAILWIND_VERSION } from "./tailwind-builtin-stylesheets";
import { withThemeManagedStartBuildIdentity } from "./theme-morph-sdk";
import { starterThemeWorkspaceFiles } from "../starter-theme-files";
import { LocalViteThemeBuildRunner } from "./local-vite-theme-build-runner";
import type { ThemeBuildRunnerInput } from "./theme-build-runner.types";
import { START_TOOLCHAIN } from "./sandbox-toolchain.test-support";
import { prepareSourcesForBuild } from "../source-language/tsx-source-language";
import { planThemeSandboxWorkspace } from "./theme-sandbox-workspace";
import { DEFAULT_APPROVED_DEPENDENCIES } from "./sandbox-vite-theme-build-runner.types";

/**
 * M3 Hide approach E, step 1: a real platform Start build of a Theme with
 * ordinary JSX, prerendered from sealed content.
 *
 * The Starter's home also mounts an author-written section the plain way,
 * `<Promo {...content("promo")} />`, with no check of its own: Morph's
 * compiled guard mounts it through the platform gate. A hidden section must
 * leave nothing in the page: no section markup, none of its stored values,
 * none of its component's defaults, in the prerendered HTML (the router's
 * serialized state included) or in the server bundle. The reverse build,
 * with the same section shown, proves the assertions can see it.
 *
 * LocalViteThemeBuildRunner is a test runner: it builds the files it is
 * given and does not prepare them. The managed build prepares them in its
 * workspace plan (planThemeSandboxWorkspace in "build" mode, through
 * prepareSourcesForBuild). So the build below is fed the output of that same
 * function, and the first case proves the managed plan writes the gate.
 */

const PROMO = `export const contentFields = {
  heading: { type: "text", label: "Heading" },
} as const;
export default function Promo({ heading = "PROMO-DEFAULT" }: { heading?: string }) {
  return <section data-promo=""><h2>{heading}</h2></section>;
}
`;

const HERO_DEFAULT = "Objects for everyday rituals.";
const FOOTER_DEFAULT = "© Online Store";

function authoredFiles() {
  return [
    ...starterThemeWorkspaceFiles().map((file) =>
      file.path === "src/routes/index.tsx"
        ? {
            ...file,
            content: `import Promo from "../components/Promo";\n${file.content}`.replace(
              "<main>",
              `<main>\n      <Promo {...content("promo")} />`,
            ),
          }
        : file,
    ),
    { path: "src/components/Promo.tsx", content: PROMO, mimeType: "text/typescript" },
  ];
}

const PROMO_GATE = `<__MorphSectionGate slot={"promo"} render={() => (<Promo {...content("promo")} />)} />`;

function input(hiddenPromo: boolean): ThemeBuildRunnerInput {
  const authored = authoredFiles();
  // The managed build's own preparation (see the note above).
  const prepared = prepareSourcesForBuild(
    authored.map((file) => ({ path: file.path, content: String(file.content) })),
  );
  expect(prepared.hideGuarded["src/routes/index.tsx"]).toContain("promo");
  const preparedByPath = new Map(
    prepared.files.map((file) => [file.path, file.content]),
  );
  const files = authored.map((file) => ({
    ...file,
    content: preparedByPath.get(file.path) ?? file.content,
  }));
  return {
    buildId: `hide-gate-${hiddenPromo ? "hidden" : "shown"}`,
    storefrontId: "store",
    themeId: "theme",
    sourceRevisionId: "source",
    revisionNumber: 1,
    entry: "src/routes/index.tsx",
    inputHash: (hiddenPromo ? "c" : "d").repeat(64),
    compilerId: "tailwind-v4-build",
    compilerVersion: withThemeManagedStartBuildIdentity(TAILWIND_VERSION),
    toolchainId: START_TOOLCHAIN.id,
    files: files as ThemeBuildRunnerInput["files"],
    contentSnapshot: {
      publicationId: "pub",
      storefrontId: "store",
      themeId: "theme",
      documents: [
        {
          item: {
            id: "home",
            publicationId: "pub",
            itemType: "template",
            contentId: "index",
            revisionId: "home-rev",
            metadata: { routePath: "/" },
          },
          document: {
            version: 1,
            sections: [
              {
                id: "promo",
                type: "promo",
                enabled: !hiddenPromo,
                props: { heading: "PROMO-STORED" },
              },
              {
                id: "starter-hero",
                type: "hero",
                enabled: false,
                props: { heading: "HERO-STORED" },
              },
              {
                id: "starter-story",
                type: "image-with-text",
                enabled: true,
                props: { heading: "STORY-STORED" },
              },
            ],
            renderPolicy: { mode: "ssg" },
          },
        },
        {
          item: {
            id: "layout",
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
                id: "starter-header",
                type: "header",
                enabled: true,
                props: { storeName: "HEADER-STORED" },
              },
              {
                id: "starter-footer",
                type: "footer",
                enabled: false,
                props: { copyrightText: "FOOTER-STORED" },
              },
            ],
          },
        },
      ],
    } as never,
  };
}

const text = (content: string | Uint8Array) =>
  typeof content === "string" ? content : new TextDecoder().decode(content);

async function build(hiddenPromo: boolean) {
  const result = await new LocalViteThemeBuildRunner({
    maxDurationMs: 200_000,
  }).run(input(hiddenPromo));
  if (!result.success) throw new Error(result.errorMessage);
  const home = result.artifacts.find(
    (file) => file.path === "runtime/client/index.html",
  );
  expect(home, "the home page is prerendered").toBeDefined();
  const server = result.artifacts
    .filter((file) => file.path.startsWith("runtime/server/"))
    .map((file) => text(file.content))
    .join("\n");
  return { html: text(home!.content), server, result };
}

describe("a hidden section in a real platform Start build, prerendered", () => {
  it("the managed build's workspace plan mounts the plain section through the gate", () => {
    const plan = planThemeSandboxWorkspace({
      files: authoredFiles().map((file) => ({
        path: file.path,
        content: String(file.content),
      })),
      entry: "src/routes/index.tsx",
      buildId: "hide-gate-plan",
      approvedDependencies: new Set(DEFAULT_APPROVED_DEPENDENCIES),
      mode: "build",
      toolchainRoot: process.cwd(),
    });
    if (!plan.ok) throw new Error(plan.errorMessage);
    const home = plan.workspaceFiles.find((file) =>
      file.path.endsWith("/src/routes/index.tsx"),
    );
    const gate = plan.workspaceFiles.find((file) =>
      file.path.endsWith("/.morph/section-gate.ts"),
    );
    const textOf = (file: (typeof plan.workspaceFiles)[number] | undefined) =>
      file && "content" in file ? String(file.content) : "";
    expect(textOf(home)).toContain(PROMO_GATE);
    expect(textOf(gate)).toContain("MorphSectionGate");
  });

  it(
    "leaves no markup, value or default of a hidden section, plain JSX or the Starter's",
    { timeout: 480_000 },
    async () => {
      const { html, server, result } = await build(true);
      // The page and its visible sections rendered, with their values.
      expect(html).toContain("STORY-STORED");
      expect(html).toContain("HEADER-STORED");
      // The hidden ones did not: not their values, not their defaults, not
      // their markup, in the page or in the router state it carries.
      for (const absent of [
        "PROMO-STORED",
        "PROMO-DEFAULT",
        "data-promo",
        "HERO-STORED",
        HERO_DEFAULT,
        "FOOTER-STORED",
        FOOTER_DEFAULT,
      ]) {
        expect(html, absent).not.toContain(absent);
      }
      expect(html).not.toContain("<footer");
      // The sealed values never reach the Worker.
      for (const absent of ["PROMO-STORED", "HERO-STORED", "FOOTER-STORED"]) {
        expect(server, absent).not.toContain(absent);
      }
      // Built under the hardened guard (and the Web Worker guard after it).
      expect(input(true).compilerVersion).toMatch(/\.hide-7\.wg-\d+$/);
      expect(result.artifacts.some((file) => file.path.includes(".morph/"))).toBe(
        false,
      );
    },
  );

  it(
    "reverse: the same build with the promo shown renders its stored value",
    { timeout: 480_000 },
    async () => {
      const { html } = await build(false);
      expect(html).toContain("PROMO-STORED");
      expect(html).toContain("data-promo");
      expect(html).not.toContain("PROMO-DEFAULT");
      expect(html).not.toContain("HERO-STORED");
    },
  );
});
