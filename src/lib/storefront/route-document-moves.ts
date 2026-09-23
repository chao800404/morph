/**
 * Carrying route-owned documents back when the route source rolls back.
 *
 * A route-owned document follows its route when the route file moves, and
 * every such route move is recorded — whether or not the route had a document
 * yet, because the document is only created by the route's first content
 * write, which may come after the move. Rolling the source back to a revision
 * puts the route files where they were then; undoing every route move
 * recorded since, newest first, carries whichever document each path holds
 * now along with it. Without that, `/about` renamed to `/company` and rolled
 * back would come back empty, its content stranded at `/company`.
 *
 * A route-owned document is named after its path as well as bound to it, and
 * both are unique per theme, so a path is taken if any page document either
 * sits at it or carries it as its name.
 */

export type RoutePathMove = Readonly<{
  fromRoutePath: string;
  toRoutePath: string;
}>;

export type RouteDocumentMove = RoutePathMove &
  Readonly<{ templateId: string }>;

/** A page document as the planner sees it. */
export type PageDocumentPlacement = Readonly<{
  id: string;
  /** Null for a document addressed by type rather than by route. */
  routePath: string | null;
  name: string;
}>;

export type RouteDocumentRollbackPlan =
  | {
      ok: true;
      /** Route moves to apply, in order: each recorded move, undone. */
      pathMoves: RoutePathMove[];
      /** The documents those moves carry, for showing what will change. */
      documentMoves: RouteDocumentMove[];
      /**
       * Which documents held each path the plan touches when it was made.
       * The apply is refused unless they still do, so what runs is what was
       * shown.
       */
      expectedOccupants: Array<{ routePath: string; templateIds: string[] }>;
    }
  | { ok: false; message: string };

/** The documents that take `path`, by route or by name, in id order. */
export function pageDocumentsTakingPath(
  documents: readonly PageDocumentPlacement[],
  path: string,
): string[] {
  return documents
    .filter((document) => document.routePath === path || document.name === path)
    .map((document) => document.id)
    .sort();
}

export function planRouteDocumentRollback(args: {
  /** Page documents as they stand. */
  documents: readonly PageDocumentPlacement[];
  /**
   * Route moves recorded after the revision, newest first; null when the
   * revision cannot be placed among them.
   */
  movesSinceRevision: readonly RoutePathMove[] | null;
  /** Route paths the revision's source declares, content-target resolved. */
  revisionRoutePaths: ReadonlySet<string>;
}): RouteDocumentRollbackPlan {
  if (args.movesSinceRevision === null) {
    // Nothing says which route each document came from. Rolling back is
    // still safe when every document's route survives it; one whose route
    // does not would be left behind with no way to tell where it belonged.
    const stranded = args.documents
      .flatMap((document) => (document.routePath ? [document.routePath] : []))
      .filter((path) => !args.revisionRoutePaths.has(path))
      .sort();
    if (stranded.length > 0) {
      return {
        ok: false,
        message: `This version was saved before page moves were recorded, so it cannot tell where the content of ${stranded.join(", ")} belonged. Restoring it would leave that content behind.`,
      };
    }
    return {
      ok: true,
      pathMoves: [],
      documentMoves: [],
      expectedOccupants: [],
    };
  }

  const current = new Map(
    args.documents.map((document) => [document.id, { ...document }]),
  );
  const touched = new Set<string>();
  const pathMoves: RoutePathMove[] = [];
  const documentMoves: RouteDocumentMove[] = [];

  for (const move of args.movesSinceRevision) {
    const from = move.toRoutePath;
    const to = move.fromRoutePath;
    touched.add(from);
    touched.add(to);
    pathMoves.push({ fromRoutePath: from, toRoutePath: to });

    const placements = [...current.values()];
    const moving = placements.find((document) => document.routePath === from);
    // The route had no document at this point: only the path moves back.
    if (!moving) continue;

    const blocking = pageDocumentsTakingPath(placements, to).filter(
      (id) => id !== moving.id,
    );
    if (blocking.length > 0) {
      return {
        ok: false,
        message: `${to} has its own content document now, so the content at ${from} cannot move back to it. Move or delete that route first.`,
      };
    }
    moving.routePath = to;
    moving.name = to;
    documentMoves.push({
      templateId: moving.id,
      fromRoutePath: from,
      toRoutePath: to,
    });
  }

  return {
    ok: true,
    pathMoves,
    documentMoves,
    expectedOccupants: [...touched].sort().map((routePath) => ({
      routePath,
      templateIds: pageDocumentsTakingPath(args.documents, routePath),
    })),
  };
}
