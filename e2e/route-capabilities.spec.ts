import { expect, test } from "@playwright/test";
import { EDITOR_PATH, openEditor } from "./helpers";
import {
  removeThemeFiles,
  themeScopeFromEditorPath,
  writeThemeFiles,
} from "./native-compat";

test.skip(!EDITOR_PATH, "Requires the disposable editor store.");

test("Design distinguishes endpoints from mixed routes and opens endpoint source without navigating the canvas", async ({
  page,
}) => {
  test.setTimeout(180_000);
  const scope = themeScopeFromEditorPath(EDITOR_PATH!);
  const files = [
    {
      path: "src/routes/e2e-endpoint.ts",
      content: `import { createFileRoute } from '@tanstack/react-router';
export const Route = createFileRoute('/e2e-endpoint')({ server: { handlers: { GET: () => new Response('ok') } } });`,
    },
    {
      path: "src/routes/e2e-mixed.tsx",
      content: `import { createFileRoute } from '@tanstack/react-router';
export const Route = createFileRoute('/e2e-mixed')({ component: () => <main>Mixed page</main>, server: { handlers: { POST: () => new Response('ok') } } });`,
    },
  ];
  await openEditor(page);
  try {
    expect((await writeThemeFiles(page, scope, files)).success).toBe(true);
    await openEditor(page);
    // SidebarGroup is a div: use its explicit accessible label, not assumptions
    // about a native role that the shared primitive does not promise.
    const endpointList = page.locator('[aria-label="Theme endpoints"]');
    await expect(
      endpointList.getByRole("button", { name: "/e2e-endpoint", exact: true }),
    ).toBeVisible();
    const pages = page.getByRole("list", { name: "Theme pages", exact: true });
    await expect(
      pages.getByRole("button", { name: "/e2e-mixed", exact: true }),
    ).toBeVisible();
    await expect(
      pages.getByRole("button", { name: "/e2e-endpoint", exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", {
        name: "Delete page /e2e-endpoint",
        exact: true,
      }),
    ).toHaveCount(0);
    await page.getByRole("button", { name: /^Current route:/ }).click();
    await page.getByPlaceholder("Search path or page...").fill("e2e-");
    await expect(page.getByRole("button", { name: /E2e Mixed/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /E2e Endpoint/ })).toHaveCount(0);
    await page.keyboard.press("Escape");
    const routeBefore = new URL(page.url()).searchParams.get("routePath");
    await endpointList
      .getByRole("button", { name: "/e2e-endpoint", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "New file", exact: true }),
    ).toBeVisible();
    await expect
      .poll(() =>
        page.evaluate(() =>
          (window as any).monaco?.editor
            .getModels()
            .find((model: any) =>
              model.uri.path.endsWith("/src/routes/e2e-endpoint.ts"),
            )
            ?.getValue(),
        ),
      )
      .toBe(files[0].content);
    expect(new URL(page.url()).searchParams.get("routePath")).toBe(routeBefore);
  } finally {
    expect(
      (
        await removeThemeFiles(
          page,
          scope,
          files.map((file) => file.path),
        )
      ).success,
    ).toBe(true);
  }
});
