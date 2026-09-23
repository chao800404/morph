import { describe, expect, it } from "vitest";
import {
  planRouteDocumentRollback,
  type PageDocumentPlacement,
} from "./route-document-moves";

const routeDocument = (id: string, path: string): PageDocumentPlacement => ({
  id,
  routePath: path,
  name: path,
});

describe("planRouteDocumentRollback", () => {
  it("carries a renamed page's document back to its old path", () => {
    expect(
      planRouteDocumentRollback({
        documents: [routeDocument("about", "/company")],
        movesSinceRevision: [
          { fromRoutePath: "/about", toRoutePath: "/company" },
        ],
        revisionRoutePaths: new Set(["/about"]),
      }),
    ).toEqual({
      ok: true,
      pathMoves: [{ fromRoutePath: "/company", toRoutePath: "/about" }],
      documentMoves: [
        {
          templateId: "about",
          fromRoutePath: "/company",
          toRoutePath: "/about",
        },
      ],
      expectedOccupants: [
        { routePath: "/about", templateIds: [] },
        { routePath: "/company", templateIds: ["about"] },
      ],
    });
  });

  it("carries a document created after the route moved", () => {
    // Renamed while it had no document; content was first written at /company.
    const plan = planRouteDocumentRollback({
      documents: [routeDocument("written-later", "/company")],
      movesSinceRevision: [
        { fromRoutePath: "/about", toRoutePath: "/company" },
      ],
      revisionRoutePaths: new Set(["/about"]),
    });
    expect(plan).toMatchObject({
      ok: true,
      documentMoves: [
        {
          templateId: "written-later",
          fromRoutePath: "/company",
          toRoutePath: "/about",
        },
      ],
    });
  });

  it("moves the path back even when no document holds it", () => {
    expect(
      planRouteDocumentRollback({
        documents: [],
        movesSinceRevision: [
          { fromRoutePath: "/about", toRoutePath: "/company" },
        ],
        revisionRoutePaths: new Set(["/about"]),
      }),
    ).toMatchObject({
      ok: true,
      pathMoves: [{ fromRoutePath: "/company", toRoutePath: "/about" }],
      documentMoves: [],
    });
  });

  it("undoes a chain of moves newest first", () => {
    // /about was renamed /company, then /team was renamed to the freed /about.
    const plan = planRouteDocumentRollback({
      documents: [routeDocument("a", "/company"), routeDocument("b", "/about")],
      movesSinceRevision: [
        { fromRoutePath: "/team", toRoutePath: "/about" },
        { fromRoutePath: "/about", toRoutePath: "/company" },
      ],
      revisionRoutePaths: new Set(["/about", "/team"]),
    });
    expect(plan).toMatchObject({
      ok: true,
      documentMoves: [
        { templateId: "b", fromRoutePath: "/about", toRoutePath: "/team" },
        { templateId: "a", fromRoutePath: "/company", toRoutePath: "/about" },
      ],
    });
  });

  it("refuses when the old path has its own document now", () => {
    const plan = planRouteDocumentRollback({
      documents: [
        routeDocument("about", "/company"),
        routeDocument("fresh", "/about"),
      ],
      movesSinceRevision: [
        { fromRoutePath: "/about", toRoutePath: "/company" },
      ],
      revisionRoutePaths: new Set(["/about"]),
    });
    expect(plan.ok).toBe(false);
    if (plan.ok) return;
    expect(plan.message).toContain("/about has its own content document");
  });

  it("counts a page document named after the old path as taking it", () => {
    const plan = planRouteDocumentRollback({
      documents: [
        routeDocument("about", "/company"),
        { id: "named", routePath: null, name: "/about" },
      ],
      movesSinceRevision: [
        { fromRoutePath: "/about", toRoutePath: "/company" },
      ],
      revisionRoutePaths: new Set(["/about"]),
    });
    expect(plan.ok).toBe(false);
  });

  describe("for a revision saved without its source generation", () => {
    it("allows it while every document's route survives", () => {
      expect(
        planRouteDocumentRollback({
          documents: [
            routeDocument("about", "/about"),
            { id: "type-page", routePath: null, name: "default" },
          ],
          movesSinceRevision: null,
          revisionRoutePaths: new Set(["/about"]),
        }),
      ).toEqual({
        ok: true,
        pathMoves: [],
        documentMoves: [],
        expectedOccupants: [],
      });
    });

    it("refuses when a document's route is not in the revision", () => {
      const plan = planRouteDocumentRollback({
        documents: [routeDocument("about", "/company")],
        movesSinceRevision: null,
        revisionRoutePaths: new Set(["/about"]),
      });
      expect(plan.ok).toBe(false);
      if (plan.ok) return;
      expect(plan.message).toContain("/company");
    });
  });
});
