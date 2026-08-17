import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function read(relativePath: string) {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

describe("theme storage import boundary", () => {
  it("keeps D1 adapter selection inside the storage composition root", () => {
    const buildService = read("../service/theme-build.service.ts");
    const buildServiceFactory = read("../service/theme-build-service.factory.ts");
    const themeServerFns = read(
      "../../../server/storefront/storefront-theme-files.serverFn.ts",
    );
    const compositionRoot = read("./theme-storage.server.ts");

    expect(buildService).not.toContain("d1-theme-storage");
    expect(buildServiceFactory).not.toContain("d1-theme-storage");
    expect(themeServerFns).not.toContain("d1-theme-storage");

    expect(compositionRoot).toContain("d1-theme-storage");
  });
});
