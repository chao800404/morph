import { describe, expect, it } from "vitest";
import { starterThemeWorkspaceFiles } from "./starter-theme-files";
import {
  SSG_PAGE_ALLOW_LIST,
  resolveSsgPageEligibility,
  ssgPageRenderClosure,
} from "./ssg-eligibility";

const starter = () =>
  starterThemeWorkspaceFiles().map((file) => ({
    path: file.path,
    content: file.content,
  }));

function edit(
  files: ReturnType<typeof starter>,
  path: string,
  change: (content: string) => string,
) {
  return files.map((file) =>
    file.path === path ? { ...file, content: change(file.content) } : file,
  );
}

describe("SSG page eligibility (server allow list)", () => {
  it("lists only the Starter home, on TanStack Start", () => {
    expect(SSG_PAGE_ALLOW_LIST).toEqual([
      {
        framework: "tanstack-start",
        routePath: "/",
        routeFile: "src/routes/index.tsx",
      },
    ]);
  });

  it("accepts the shipped Starter home, whose whole render closure is the Starter's bytes", () => {
    expect(
      resolveSsgPageEligibility({
        framework: "tanstack-start",
        files: starter(),
        routePath: "/",
      }),
    ).toEqual({ eligible: true });
  });

  it("checks the root layout, the shared header and footer and the page's sections, not just the route", () => {
    const closure = ssgPageRenderClosure(starter(), "src/routes/index.tsx");
    expect(closure).toEqual(
      expect.arrayContaining([
        "src/routes/index.tsx",
        "src/routes/__root.tsx",
        "src/router.tsx",
        "src/layouts/StorefrontLayout.tsx",
        "src/components/Header.tsx",
        "src/components/Footer.tsx",
        "src/morph/content.ts",
      ]),
    );
    // A route the home never renders is not part of its closure.
    expect(closure).not.toContain("src/routes/account.tsx");
  });

  it("refuses the home once a shared header in its closure is edited (it could read the cart)", () => {
    const files = edit(starter(), "src/components/Header.tsx", (content) =>
      `${content}\n// reads the cart now\n`,
    );
    expect(
      resolveSsgPageEligibility({
        framework: "tanstack-start",
        files,
        routePath: "/",
      }),
    ).toMatchObject({
      eligible: false,
      code: "SSG_PAGE_SOURCE_NOT_VERIFIED",
    });
  });

  it("refuses the home once its route or a file it newly imports is not the Starter's", () => {
    const route = edit(starter(), "src/routes/index.tsx", (content) =>
      content.replace(
        'import { createFileRoute } from "@tanstack/react-router";',
        'import { createFileRoute } from "@tanstack/react-router";\nimport "../cart-badge";',
      ),
    );
    route.push({ path: "src/cart-badge.ts", content: "export {};" });
    expect(
      resolveSsgPageEligibility({
        framework: "tanstack-start",
        files: route,
        routePath: "/",
      }),
    ).toMatchObject({ eligible: false, code: "SSG_PAGE_SOURCE_NOT_VERIFIED" });
  });

  it("refuses a closure file that is missing from the build's source", () => {
    const files = starter().filter(
      (file) => file.path !== "src/components/Footer.tsx",
    );
    expect(
      resolveSsgPageEligibility({
        framework: "tanstack-start",
        files,
        routePath: "/",
      }),
    ).toMatchObject({ eligible: false, code: "SSG_PAGE_SOURCE_NOT_VERIFIED" });
  });

  it("refuses every route that is not listed, including Starter routes that read the session", () => {
    for (const routePath of ["/account", "/order-transfer", "/landing", "/about"]) {
      expect(
        resolveSsgPageEligibility({
          framework: "tanstack-start",
          files: starter(),
          routePath,
        }),
      ).toMatchObject({ eligible: false, code: "SSG_PAGE_NOT_LISTED" });
    }
  });

  it("refuses another framework and a Theme built with its own build config", () => {
    expect(
      resolveSsgPageEligibility({
        framework: "astro",
        files: starter(),
        routePath: "/",
      }),
    ).toMatchObject({ eligible: false, code: "SSG_PAGE_NOT_LISTED" });
    expect(
      resolveSsgPageEligibility({
        framework: "tanstack-start",
        buildMode: "native",
        files: starter(),
        routePath: "/",
      }),
    ).toMatchObject({ eligible: false, code: "SSG_OWN_BUILD_CONFIG" });
  });
});
