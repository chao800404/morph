import { describe, expect, it } from "vitest";
import { materializeThemeBuildInput } from "./theme-build-materializer";
import type {
  StorefrontThemeBuildDTO,
  ThemeBuildContentSnapshot,
} from "../dto/storefront-theme-build.dto";
import type { StorefrontThemeRevisionDTO } from "../dto/storefront-theme-file.dto";

const build = (): StorefrontThemeBuildDTO => ({
  id: "build-a",
  storefrontId: "store-a",
  themeId: "theme-a",
  sourceRevisionId: "source-a",
  contentPublicationId: "publication-a",
  status: "queued",
  inputHash: null,
  compilerId: null,
  compilerVersion: null,
  artifactPrefix: null,
  manifestJson: null,
  diagnosticsJson: null,
  errorMessage: null,
  startedAt: null,
  completedAt: null,
  createdBy: null,
  createdAt: "now",
  updatedAt: "now",
});
const revision: StorefrontThemeRevisionDTO = {
  id: "source-a",
  storefrontId: "store-a",
  themeId: "theme-a",
  revisionNumber: 1,
  message: null,
  source: "manual",
  createdBy: null,
  createdAt: "now",
  snapshot: [
    {
      path: "src/pages/index.tsx",
      content: "export default () => <h1>Home</h1>;",
      mimeType: "text/tsx",
      isEntry: true,
    },
  ],
};
const snapshot = (): ThemeBuildContentSnapshot => ({
  publicationId: "publication-a",
  storefrontId: "store-a",
  themeId: "theme-a",
  documents: [
    {
      item: {
        id: "item-a",
        publicationId: "publication-a",
        itemType: "template",
        contentId: "home",
        revisionId: "home-live",
      },
      document: {
        version: 1,
        sections: [
          {
            id: "hero",
            type: "hero",
            enabled: true,
            props: { title: "Original" },
          },
        ],
      },
    },
  ],
});

describe("immutable build content identity", () => {
  it("passes the exact sealed content to the runner input", () => {
    const contentSnapshot = snapshot();
    const input = materializeThemeBuildInput({
      build: build(),
      revision,
      contentSnapshot,
    });
    expect(input.contentSnapshot).toEqual(contentSnapshot);
  });

  it("keeps legacy source-only hashes unchanged when no content is bound", () => {
    const unbound = build();
    delete unbound.contentPublicationId;
    const original = materializeThemeBuildInput({ build: unbound, revision });
    expect(
      materializeThemeBuildInput({
        build: { ...unbound, contentPublicationId: null },
        revision,
      }).inputHash,
    ).toBe(original.inputHash);
    expect(original.contentSnapshot).toBeUndefined();
  });

  it.each(["missing", "publication", "storefront", "theme", "item"])(
    "rejects a %s snapshot mismatch",
    (kind) => {
      const contentSnapshot = snapshot();
      if (kind === "publication")
        contentSnapshot.publicationId = "publication-b";
      if (kind === "storefront") contentSnapshot.storefrontId = "store-b";
      if (kind === "theme") contentSnapshot.themeId = "theme-b";
      if (kind === "item")
        contentSnapshot.documents[0]!.item.publicationId = "publication-b";
      expect(() =>
        materializeThemeBuildInput({
          build: build(),
          revision,
          contentSnapshot: kind === "missing" ? undefined : contentSnapshot,
        }),
      ).toThrow("BUILD_CONTENT_SNAPSHOT_MISMATCH");
    },
  );

  it("refuses to silently add content to a source-only build", () => {
    expect(() =>
      materializeThemeBuildInput({
        build: { ...build(), contentPublicationId: null },
        revision,
        contentSnapshot: snapshot(),
      }),
    ).toThrow("BUILD_CONTENT_SNAPSHOT_MISMATCH");
  });

  it.each(["publication", "revision", "document", "route", "policy"])(
    "changes identity when %s changes",
    (kind) => {
      const original = materializeThemeBuildInput({
        build: build(),
        revision,
        contentSnapshot: snapshot(),
      });
      const contentSnapshot = snapshot();
      const nextBuild = build();
      if (kind === "publication") {
        contentSnapshot.publicationId = nextBuild.contentPublicationId =
          "publication-b";
        contentSnapshot.documents[0]!.item.publicationId = "publication-b";
      }
      if (kind === "revision")
        contentSnapshot.documents[0]!.item.revisionId = "home-new";
      if (kind === "document")
        contentSnapshot.documents[0]!.document.sections[0]!.props.title =
          "Changed";
      if (kind === "route")
        contentSnapshot.documents[0]!.item.metadata = { routePath: "/new" };
      if (kind === "policy")
        contentSnapshot.documents[0]!.document.renderPolicy = { mode: "ssg" };
      expect(
        materializeThemeBuildInput({
          build: nextBuild,
          revision,
          contentSnapshot,
        }).inputHash,
      ).not.toBe(original.inputHash);
    },
  );

  it("ignores item row IDs and query order, but not their content identity", () => {
    const contentSnapshot = snapshot();
    contentSnapshot.documents.push({
      item: {
        ...contentSnapshot.documents[0]!.item,
        id: "item-b",
        contentId: "about",
      },
      document: { version: 1, sections: [] },
    });
    const original = materializeThemeBuildInput({
      build: build(),
      revision,
      contentSnapshot,
    }).inputHash;
    contentSnapshot.documents.reverse();
    contentSnapshot.documents[0]!.item.id = "different-row-id";
    expect(
      materializeThemeBuildInput({ build: build(), revision, contentSnapshot })
        .inputHash,
    ).toBe(original);
  });

  it("rejects altered content after inputHash has been frozen", () => {
    const contentSnapshot = snapshot();
    const original = materializeThemeBuildInput({
      build: build(),
      revision,
      contentSnapshot,
    });
    contentSnapshot.documents[0]!.document.sections[0]!.props.title =
      "Tampered";
    expect(() =>
      materializeThemeBuildInput({
        build: { ...build(), inputHash: original.inputHash },
        revision,
        contentSnapshot,
      }),
    ).toThrow("INPUT_HASH_MISMATCH");
  });
});
