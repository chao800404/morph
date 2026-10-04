import { createHash } from "node:crypto";
import { expect, test } from "@playwright/test";
import { EDITOR_PATH, openEditor } from "./helpers";

test.skip(!EDITOR_PATH, "Requires the disposable editor store.");

test("Code creates and edits public text as validated bytes, then reopens the saved content", async ({
  page,
}) => {
  test.setTimeout(240_000);
  await openEditor(page);
  await page.getByRole("button", { name: /^Code$/ }).focus();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("button", { name: "New file", exact: true }),
  ).toBeVisible();
  const path = "public/e2e-code-data.json";
  const writeResponse = () =>
    page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        new URL(response.url()).pathname ===
          "/api/storefront/theme-binary-file" &&
        new URL(response.url()).searchParams.get("path") === path,
    );
  await page.getByRole("button", { name: "New file", exact: true }).click();
  const name = page.getByRole("textbox", {
    name: "New file name",
    exact: true,
  });
  await name.fill(path);
  const created = writeResponse();
  await name.press("Enter");
  expect((await (await created).json()).success).toBe(true);
  await expect
    .poll(() =>
      page.evaluate((target) => {
        const model = (window as any).monaco?.editor
          .getModels()
          .find((model: any) => model.uri.path.endsWith(`/${target}`));
        return model?.getValue();
      }, path),
    )
    .toBe("{}\n");
  const content = '{"title":"中文","items":[1,2]}\n';
  const saved = writeResponse();
  await page.evaluate(
    ({ path, content }) => {
      (window as any).monaco.editor
        .getModels()
        .find((model: any) => model.uri.path.endsWith(`/${path}`))
        .setValue(content);
    },
    { path, content },
  );
  await page.keyboard.press("Control+s");
  const response = await saved;
  expect(response.status()).toBe(200);
  const body = await response.json();
  expect(body.success).toBe(true);
  expect(body.data.encoding).toBe("binary");
  expect(body.data.blobDigest).toBe(
    createHash("sha256").update(content).digest("hex"),
  );
  const match = /\/store\/([^/]+)\/themes\/([^/]+)/.exec(page.url());
  expect(match).not.toBeNull();
  const read = await page.request.get(
    `/api/storefront/theme-binary-file?${new URLSearchParams({
      storefrontId: match![1],
      themeId: match![2],
      path,
      digest: body.data.blobDigest,
    })}`,
  );
  expect(read.status()).toBe(200);
  expect(await read.text()).toBe(content);
  // Reopen through the shared readiness check. SSR already shows the Code
  // button before hydration attaches its handler; clicking it then is a no-op.
  await openEditor(page);
  await page.getByRole("button", { name: /^Code$/ }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: "New file", exact: true })).toBeVisible();
  await page
    .locator(`[data-file-tree-file="${path}"]`)
    .getByText("e2e-code-data.json", { exact: true })
    .click({ timeout: 15_000 });
  await expect
    .poll(
      () =>
        page.evaluate(
          (target) =>
            (window as any).monaco?.editor
              .getModels()
              .find((model: any) => model.uri.path.endsWith(`/${target}`))
              ?.getValue(),
          path,
        ),
      { timeout: 30_000 },
    )
    .toBe(content);
});
