import { describe, expect, it } from "vitest";
import {
  getThemeDependencyCatalog,
  mergeThemeDependencyMaps,
  validateThemeDependencySelection,
} from "./theme-dependency-policy";

describe("theme dependency policy", () => {
  const approved = {
    react: "19.2.1",
    "react/jsx-runtime": "19.2.1",
    "@tanstack/react-router": "1.170.18",
  } as const;

  it("exposes one catalog item per package root", () => {
    expect(getThemeDependencyCatalog(approved)).toEqual([
      {
        name: "@tanstack/react-router",
        root: "@tanstack/react-router",
        version: "1.170.18",
      },
      { name: "react", root: "react", version: "19.2.1" },
    ]);
  });

  it("rejects packages and versions outside cms.config", () => {
    expect(
      validateThemeDependencySelection(
        { react: "18.0.0", three: "0.1.0" },
        approved,
      ),
    ).toEqual([
      'Theme dependency "react" must use the platform-approved version "19.2.1".',
      'Theme dependency "three" is not approved in cms.config.ts.',
    ]);
  });

  it("merges selected packages deterministically", () => {
    expect(
      mergeThemeDependencyMaps(approved, {
        "@tanstack/react-router/devtools": "1.170.18",
      }),
    ).toEqual({
      "@tanstack/react-router": "1.170.18",
      "@tanstack/react-router/devtools": "1.170.18",
      react: "19.2.1",
      "react/jsx-runtime": "19.2.1",
    });
  });
});
