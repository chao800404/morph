import type {
  PreviewCapability,
  PreviewSelectionMessage,
} from "./preview-protocol";
import { parseAstroInstanceIdentity } from "../theme-framework/astro-preview-locate";
import type {
  AstroBindingFailureClass,
  AstroRouteBindingsView,
} from "../source-language/astro-route-bindings";

/**
 * What an Astro canvas click may ask Core to confirm as a Design selection
 * (M2 PR-I, P3). Resolved against Core's binding view by
 * `resolveAstroDesignSelection` (PR-F); every Astro click still locates
 * (L1.5a, `resolveSourceLocatedTarget`), which this never replaces.
 *
 * - `needs-reload`: the frame on screen did not announce `astro-identity-v2`
 *   in this ready (an older preview). No Design selection; reload the
 *   preview to get one.
 * - `unavailable`: a v2 frame, but this click names no identity Core could
 *   verify (outside every boundary, a range the bridge refused, no v2 id, no
 *   `sourceDigest`).
 * - `pending-core`: an identity to hand to Core. It is a claim from a page
 *   that runs author code, not a selection: Core's verification
 *   (`verifyAstroInstanceIdentity`) decides, and the capability plays no
 *   part in that.
 */
export type AstroDesignSelectionRequest =
  | Readonly<{ status: "needs-reload" }>
  | Readonly<{
      status: "unavailable";
      reason: "outside" | "not-selectable" | "no-identity" | "no-source-digest";
    }>
  | Readonly<{
      status: "pending-core";
      marker: string;
      sourceLocation: string;
      sourceDigest: string;
    }>;

export function astroDesignSelectionRequest(
  message: PreviewSelectionMessage,
  frameCapabilities: ReadonlySet<PreviewCapability>,
): AstroDesignSelectionRequest {
  if (!frameCapabilities.has("astro-identity-v2")) {
    return { status: "needs-reload" };
  }
  const boundary = message.previewBoundary;
  if (!boundary || boundary.reason === "outside") {
    return { status: "unavailable", reason: "outside" };
  }
  if (!boundary.selectable) {
    return { status: "unavailable", reason: "not-selectable" };
  }
  if (!boundary.marker || !parseAstroInstanceIdentity(boundary.marker)) {
    return { status: "unavailable", reason: "no-identity" };
  }
  if (!message.sourceDigest || !message.sourceLocation) {
    return { status: "unavailable", reason: "no-source-digest" };
  }
  return {
    status: "pending-core",
    marker: boundary.marker,
    sourceLocation: message.sourceLocation,
    sourceDigest: message.sourceDigest,
  };
}

/**
 * The four refusal classes of M2 plan v2 §6.2, as the binding view and the
 * write name them (`AstroBindingFailureClass`).
 */
export type AstroDesignHintClass = AstroBindingFailureClass;

/**
 * What the author is told when an Astro element is not a Design selection
 * (plan v2 §6.2), and the one action that can help. Never a write: the hint
 * is shown beside the L1.5a locate, which still opens Code.
 *
 * - `retry`: ask Core again (the binding view is read again; nothing is
 *   resent on its own).
 * - `reload-preview`: the frame shows other source than Core read.
 * - `open-code`: Design does not handle this; Code does.
 */
export type AstroDesignHint = Readonly<{
  class: AstroDesignHintClass;
  reason: string;
  message: string;
  action: "retry" | "reload-preview" | "open-code";
}>;

/** Class A reasons a second ask can clear; the rest need a reload. */
const RETRY_REASONS = new Set([
  "parser-busy",
  "parser-wait-timeout",
  "parser-trapped",
  "parser-unavailable",
  "parser-fault",
  "parser-binding-failed",
  "parser-invalid-response",
  "parser-contract-mismatch",
  "parser-version-mismatch",
]);

/** The §6.2 wording of a class and reason; English, as the editor's UI. */
export function astroDesignHint(
  klass: AstroDesignHintClass,
  reason: string,
): AstroDesignHint {
  switch (klass) {
    case "temporarily-unconfirmable":
      if (reason === "parser-binding-missing") {
        return {
          class: klass,
          reason,
          action: "open-code",
          message:
            "This environment has no .astro analysis service, so Design editing isn't available for Astro pages here. Use Code mode.",
        };
      }
      if (RETRY_REASONS.has(reason)) {
        return {
          class: klass,
          reason,
          action: "retry",
          message:
            "This section can't be confirmed right now; the source is fine. Try again in a moment.",
        };
      }
      return {
        class: klass,
        reason,
        action: "reload-preview",
        message:
          "This section can't be confirmed against the source the preview shows; the source is fine. Reload the preview, then select it again.",
      };
    case "capability-limit":
      return {
        class: klass,
        reason,
        action: "open-code",
        message:
          "Design doesn't support this way of writing the page, or a file this large, yet. You can edit it in Code mode.",
      };
    case "author-syntax":
      return {
        class: klass,
        reason,
        action: "open-code",
        message:
          "This file has a syntax error. Open it in Code mode to see where.",
      };
    case "controlled-by-code":
      return {
        class: klass,
        reason,
        action: "open-code",
        message:
          "This content is controlled by code, so it can't be edited in Design. Edit it in Code mode.",
      };
  }
}

/** Not a section: the click is located in Code, with no Design selection. */
const OUTSIDE_SECTION_HINT: AstroDesignHint = {
  class: "capability-limit",
  reason: "outside-section",
  action: "open-code",
  message:
    "This element isn't part of a section Design can edit. It is opened in Code mode.",
};

type AstroDesignViewArgs = Readonly<{
  /** Core's binding view of the page, or null while it is not read. */
  view: AstroRouteBindingsView | null;
  /** The saved source generation the editor's workspace holds now. */
  workspaceSourceGeneration: number | null;
  /** The page the editor is on. */
  routePath: string;
}>;

export type AstroDesignPageStatus =
  | Readonly<{ status: "checking" }>
  | Readonly<{ status: "confirmed" }>
  | Readonly<{ status: "refused"; hint: AstroDesignHint }>;

/**
 * Whether Core's view of the editor's page can be used at all: read, of the
 * source the workspace holds, of this page, and confirmed. Decided by the
 * view's status, never by the framework's name.
 */
export function astroDesignPageStatus(
  args: AstroDesignViewArgs,
): AstroDesignPageStatus {
  const { view } = args;
  if (!view || args.workspaceSourceGeneration === null) {
    return { status: "checking" };
  }
  if (
    view.sourceGeneration !== args.workspaceSourceGeneration ||
    view.routePath !== args.routePath
  ) {
    return {
      status: "refused",
      hint: astroDesignHint("temporarily-unconfirmable", "source-stale"),
    };
  }
  if (view.status.kind === "refused") {
    return {
      status: "refused",
      hint: astroDesignHint(view.status.class, view.status.reason),
    };
  }
  return { status: "confirmed" };
}

/**
 * An Astro Design selection: the instance Core confirmed for the click, and
 * what a write of it carries. `identity` is the frame's v2 id, which matched
 * Core's instance exactly; `componentDigest` is Core's, never the frame's.
 * Both stay claims to the write: Core verifies them again on the source it
 * writes against (`verifyAstroSectionWriteIdentity`).
 */
export type AstroDesignSelection =
  | Readonly<{
      status: "confirmed";
      sectionId: string;
      identity: string;
      componentDigest: string;
      componentRef: string;
      sectionType: string;
      declaredFields: readonly string[];
      /** Declared fields this call site proves come from the section. */
      fields: readonly string[];
      /**
       * Those of `fields` proven only while the stored section has its own
       * value for them (a literal before the spread); Core refuses a write
       * of one the stored section lacks.
       */
      ownKeyFields: readonly string[];
    }>
  | Readonly<{ status: "checking" }>
  | Readonly<{ status: "refused"; hint: AstroDesignHint }>;

/**
 * What an Astro click is, given Core's binding view (M2 PR-F). A Design
 * selection only for an exact match: the view is of the workspace's source
 * generation and the editor's page, confirmed, and has an instance whose
 * rule, route sha256 and range equal the click's v2 id and whose component
 * digest equals the frame's. Nothing is matched by name, ordinal or the
 * stored Document.
 */
export function resolveAstroDesignSelection(
  args: AstroDesignViewArgs &
    Readonly<{ request: AstroDesignSelectionRequest }>,
): AstroDesignSelection {
  const { request } = args;
  if (request.status === "needs-reload") {
    return {
      status: "refused",
      hint: astroDesignHint(
        "temporarily-unconfirmable",
        "preview-identity-legacy",
      ),
    };
  }
  if (request.status === "unavailable") {
    return { status: "refused", hint: OUTSIDE_SECTION_HINT };
  }
  const page = astroDesignPageStatus(args);
  if (page.status !== "confirmed") return page;
  const view = args.view!;
  const clicked = parseAstroInstanceIdentity(request.marker);
  const instance = clicked
    ? view.instances.find(
        (candidate) =>
          candidate.identity.rule === clicked.rule &&
          candidate.identity.src === clicked.src &&
          candidate.identity.start === clicked.start &&
          candidate.identity.end === clicked.end,
      )
    : undefined;
  if (!instance || instance.componentDigest !== request.sourceDigest) {
    return {
      status: "refused",
      hint: astroDesignHint(
        "temporarily-unconfirmable",
        "preview-identity-mismatch",
      ),
    };
  }
  if (instance.section === null) {
    return {
      status: "refused",
      hint: astroDesignHint("controlled-by-code", "section-unbound"),
    };
  }
  const declared = new Set(instance.declaredFields);
  const proven = instance.claims.filter(
    (claim) => claim.slot === instance.section && declared.has(claim.field),
  );
  const fields = proven.map((claim) => claim.field);
  const ownKeyFields = proven
    .filter((claim) => claim.requiresOwnKey === true)
    .map((claim) => claim.field);
  if (fields.length === 0) {
    return {
      status: "refused",
      hint: astroDesignHint("controlled-by-code", "no-proven-field"),
    };
  }
  return {
    status: "confirmed",
    sectionId: instance.section,
    identity: request.marker,
    componentDigest: instance.componentDigest,
    componentRef: instance.componentRef,
    sectionType: instance.sectionType,
    declaredFields: [...instance.declaredFields],
    fields,
    ownKeyFields,
  };
}

/**
 * The identity fields of a section write (`identity`, `componentDigest`): a
 * confirmed Astro selection's, and none otherwise, so a Start write is sent
 * exactly as before.
 */
export function astroWriteIdentity(
  selection: AstroDesignSelection | null | undefined,
): Readonly<{ identity?: string; componentDigest?: string }> {
  if (selection?.status !== "confirmed") return {};
  return {
    identity: selection.identity,
    componentDigest: selection.componentDigest,
  };
}
