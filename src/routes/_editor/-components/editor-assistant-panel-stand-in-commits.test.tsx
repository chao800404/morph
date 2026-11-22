/**
 * Investigation (#427 follow-up): does a panel render end in one more commit
 * of its own?
 *
 * A selection with no Document section behind it (a component authored in
 * code) gets a stand-in section built inline in `EditorAssistantPanel`, with a
 * fresh `props: {}` on every render. The Inspector's content hook rebases on
 * `sectionProps` by identity and always sets a new object, so every panel
 * render would be followed by one more Inspector commit: the same "commit ends
 * in an update" shape #427 removes from the shell.
 *
 * The assertions state the wanted behaviour (one commit per panel render).
 */
import { act, render, renderHook } from "@testing-library/react";
import { Profiler, type ReactNode } from "react";
import { describe, expect, it } from "vitest";
import {
  deriveThemeLayoutSections,
  deriveThemeRouteSections,
} from "@/lib/storefront/compiler/theme-route-sections";
import {
  createDefaultStorefrontHomeDocument,
  createDefaultStorefrontLayoutDocument,
} from "@/lib/storefront/default-storefront-document";
import { resolveEditorSectionModel } from "@/lib/storefront/editor/editor-section-model";
import { STARTER_THEME_FILES } from "@/lib/storefront/starter-theme-files";
import { EditorAssistantPanel } from "./editor-assistant-panel";
import { useInspectorContentProps } from "./style-inspector/use-inspector-content-props";

const files = STARTER_THEME_FILES.map((file) => ({
  path: file.path,
  content: file.content,
  mimeType: file.mimeType,
}));

function panelFixture() {
  const shell = deriveThemeLayoutSections(files);
  const route = deriveThemeRouteSections(files, "src/routes/index.tsx");
  const pageTemplate = {
    id: "page",
    document: createDefaultStorefrontHomeDocument(),
  };
  const model = resolveEditorSectionModel({
    pageTemplate,
    shellTemplate: {
      id: "shell",
      document: createDefaultStorefrontLayoutDocument(),
    },
    pageSections: route.sections,
    pageOwnsStructure: route.hasContentImport,
    shellSections: shell.sections,
  });
  const context = {
    storefront: {
      id: "s",
      name: "Store",
      domain: null,
      status: "draft",
      activeReleaseId: null,
    },
    theme: {
      id: "t",
      name: "Default",
      status: "published",
      sourceGeneration: 1,
      activeBuild: null,
    },
    templates: [
      {
        ...pageTemplate,
        type: "index",
        name: "Default",
        document: model.document,
        draftRevisionId: null,
        publishedRevisionId: null,
        draftGeneration: 1,
      },
    ],
    files,
    panelTab: "styles",
  } as never;
  const search = {
    template: "index",
    templateId: "page",
    viewport: "desktop",
  } as never;
  return { context, search, sharedLayoutPaths: model.sharedSourcePaths };
}

function selectionFor(sectionId: string) {
  return {
    sectionId,
    kind: "text",
    componentType: "custom",
    tagName: "p",
    role: null,
    inputType: null,
    nodeId: null,
    sourceFilePath: "src/components/Hero.tsx",
    elementKey: null,
    fieldKey: null,
    fieldPath: null,
    itemId: null,
    className: "",
    isSection: false,
    computed: null,
    parentComputed: null,
    sectionComputed: null,
    inspectorOverride: null,
  } as never;
}

/**
 * Commits after a panel re-render caused by one unrelated prop changing
 * (`onTabChange`, a new function, as an unmemoized shell callback would be).
 */
function commitsPerPanelRender(sectionId: string, rerenders: number) {
  const fixture = panelFixture();
  const selection = selectionFor(sectionId);
  let commits = 0;
  const tree = (onTabChange: () => void): ReactNode => (
    <Profiler
      id="panel"
      onRender={() => {
        commits += 1;
      }}
    >
      <EditorAssistantPanel
        context={fixture.context}
        search={fixture.search}
        themeFiles={files as never}
        sharedLayoutPaths={fixture.sharedLayoutPaths}
        selection={selection}
        onTabChange={onTabChange}
      />
    </Profiler>
  );
  const view = render(tree(() => {}));
  // Let the mount settle (pre-render scheduling, first rebase).
  act(() => {});
  const perRender: number[] = [];
  for (let index = 0; index < rerenders; index += 1) {
    const before = commits;
    act(() => {
      view.rerender(tree(() => {}));
    });
    perRender.push(commits - before);
  }
  view.unmount();
  return perRender;
}

describe("a panel render schedules no further commit of its own", () => {
  it("control: a selection with a stored section commits once per panel render", () => {
    expect(commitsPerPanelRender("starter-hero", 5)).toEqual([1, 1, 1, 1, 1]);
  });

  it("a code component's stand-in section commits once per panel render", () => {
    expect(
      commitsPerPanelRender("code-only-section", 5),
      "commits per panel render, stand-in section",
    ).toEqual([1, 1, 1, 1, 1]);
  });
});

describe("useInspectorContentProps, same props by value", () => {
  it("renders once per parent render when the props are equal but not identical", () => {
    let renders = 0;
    const { rerender } = renderHook(
      ({ props }) => {
        renders += 1;
        return useInspectorContentProps({
          resourceKey: "store:theme",
          sectionId: "hero",
          sectionProps: props,
        });
      },
      { initialProps: { props: {} as Record<string, unknown> } },
    );
    const perRender: number[] = [];
    for (let index = 0; index < 5; index += 1) {
      const before = renders;
      rerender({ props: {} });
      perRender.push(renders - before);
    }
    expect(perRender, "hook renders per parent render").toEqual([
      1, 1, 1, 1, 1,
    ]);
  });
});
