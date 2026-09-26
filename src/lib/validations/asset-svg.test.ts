// @vitest-environment node
import { describe, expect, it } from "vitest";
import { SVG_VALIDATOR_VERSION } from "@/lib/security/svg-validation";
import { validateSvgContent } from "./asset";

const file = (text: string, name = "logo.svg") =>
  new File([text], name, { type: "image/svg+xml" });
const svg = (body: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 4 4">${body}</svg>`;

describe("validateSvgContent", () => {
  it("accepts a drawing, naming the rules it passed", async () => {
    expect(
      await validateSvgContent(file(svg('<rect width="4" height="4"/>'))),
    ).toEqual({
      success: true,
      validatorVersion: SVG_VALIDATOR_VERSION,
    });
  });

  it("refuses what the string checks it replaces let through", async () => {
    // Neither the tag list nor the href pattern of the old check saw these.
    for (const body of [
      "<style>rect { fill: url(https://evil.test/beacon) }</style>",
      '<rect style="background:url(//evil.test/x)"/>',
      '<set attributeName="href" to="javascript:alert(1)"/>',
      '<a href="#x"><rect/></a>',
    ]) {
      const result = await validateSvgContent(file(svg(body)));
      expect(result.success, body).toBe(false);
    }
  });

  it("says why, once, for the caller to end the sentence", async () => {
    const result = await validateSvgContent(
      file(svg("<script>alert(1)</script>")),
    );
    if (result.success) throw new Error("expected a refusal");
    expect(result.message).toContain("<script>");
    expect(result.message).toContain("Edit the original file");
    expect(result.message.endsWith(".")).toBe(false);
  });

  it("keeps the library's own size limit", async () => {
    const big = svg(`<!--${"x".repeat(2 * 1024 * 1024)}-->`);
    expect(await validateSvgContent(file(big))).toEqual({
      success: false,
      message: "SVG files must be 2MB or smaller",
    });
  });
});
