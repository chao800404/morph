import type { ComponentProps } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { toast } from "sonner";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StorefrontThemeEditorDTO } from "@/lib/storefront/dto/storefront-theme.dto";
import { useThemeWorkspaceStore } from "@/lib/storefront/store/theme-workspace-store";
import type { StorefrontThemeEditorSearch } from "@/lib/validations/storefront-theme";
import {
  createLiveFrame,
  LIVE_FRAME_CAPABILITIES,
} from "@/lib/test-utils/preview-frame-handshake";
import { storefrontThemeFileQueries } from "../-queries/storefront-theme-files.queries";
import { themePreviewServerQueries } from "../-queries/theme-preview-server.queries";
import { VisualEditorShell } from "./visual-editor-shell";

/**
 * What the editor sends as the author types into an Inspector field
 * (`update-selection-field`), and when it sends nothing.
 *
 * The post names the section the Inspector is bound to. It goes only when
 * that section is the one selected, the editor holds it as shown, the frame
 * shows the editor's page (#270's `frameShowsEditorPage`), and the frame said
 * on its ready in this round that it reads that name. Otherwise the field
 * still saves as usual; the canvas just is not told as the author types. A
 * frame that never said so gets one quiet status near the preview, not a
 * toast per keystroke.
 *
 * The real shell, Inspector and handshake; the preview is played through
 * `postEditorToPreviewMessage` (as in `visual-editor-shell-hidden-values`),
 * and the server by a small in-memory document.
 */

const EDITOR_ORIGIN = "http://localhost:3000";
const PREVIEW_ORIGIN = "https://preview.morph.test";
const PREVIEW_SESSION = "5f0f0f6e-6c2e-4f1c-9a3e-0f9a2b7c1d4e";
const FRAME = { origin: PREVIEW_ORIGIN, session: PREVIEW_SESSION } as const;
const HERO_PATH = "src/components/Hero.tsx";
const SELECTION_FIELD = "morph:storefront-preview-update-selection-field";
const UNAVAILABLE = "Live preview typing unavailable — reload the preview to restore";

const posted: Array<Record<string, unknown>> = [];
const updateSectionProps = vi.hoisted(() => vi.fn());
const getThemeEditor = vi.hoisted(() => vi.fn());

vi.mock("@/server/storefront/storefront-themes.serverFn", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  updateStorefrontThemeSectionProps: updateSectionProps,
  getStorefrontThemeEditor: getThemeEditor,
}));
vi.mock("@/lib/storefront/editor/preview-protocol", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  postEditorToPreviewMessage: vi.fn((_target: unknown, message: Record<string, unknown>) => {
    posted.push(message);
  }),
}));
vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  Link: ({ to, children, ...rest }: { to?: string; children?: React.ReactNode }) => (
    <a href={to} {...rest}>
      {children}
    </a>
  ),
}));
/**
 * The real panel, with one button that reports typing for a section the
 * test names: the Inspector reports its own bound section, and this is how a
 * report for another one (or with nothing selected) is made.
 */
const typedFor = vi.hoisted(() => ({ sectionId: "hero" }));
vi.mock("./editor-assistant-panel", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./editor-assistant-panel")>();
  const RealPanel = actual.EditorAssistantPanel;
  return {
    ...actual,
    EditorAssistantPanel: (props: ComponentProps<typeof RealPanel>) => (
      <>
        <RealPanel {...props} />
        <button
          type="button"
          onClick={() =>
            props.onPreviewSelectionField?.(typedFor.sectionId, "heading", "heading", "From the panel")
          }
        >
          Type for a named section
        </button>
      </>
    ),
  };
});

const source = `export const contentFields = {
  heading: { type: "text", label: "Heading" },
  subheading: { type: "text", label: "Subheading" }
};
export function Hero({ heading = "Welcome", subheading = "Summary" }) {
  return <section><h1 data-morph-node="heading">{heading}</h1><p>{subheading}</p></section>;
}`;

let server: { generation: number; sections: Array<Record<string, unknown>> };
function contextOf(): StorefrontThemeEditorDTO {
  return {
    previewChannel: { editorOrigin: EDITOR_ORIGIN, sessionId: PREVIEW_SESSION },
    storefront: { id: "storefront-1", name: "Store", domain: null, status: "active" },
    theme: { id: "theme-1", name: "Theme", sourceGeneration: 1 },
    templates: [
      {
        id: "template-1",
        type: "index",
        name: "Home",
        document: { version: 1, sections: JSON.parse(JSON.stringify(server.sections)) },
        draftGeneration: server.generation,
        version: 1,
      },
    ],
  } as unknown as StorefrontThemeEditorDTO;
}

const search = {
  template: "index",
  templateId: "template-1",
  viewport: "desktop",
  section: "hero",
} as StorefrontThemeEditorSearch;

function readyClient() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(themePreviewServerQueries.forTheme("storefront-1", "theme-1").queryKey, {
    success: true,
    message: "Live Preview server ready",
    data: { url: `${PREVIEW_ORIGIN}/store/1/themes/1/preview` },
  } as never);
  client.setQueryData(storefrontThemeFileQueries.tree("storefront-1", "theme-1").queryKey, {
    files: [
      {
        id: "file-hero",
        storefrontId: "storefront-1",
        themeId: "theme-1",
        path: HERO_PATH,
        content: source,
        mimeType: "text/typescript",
        isEntry: false,
        version: 1,
        createdAt: "2026-10-18T00:00:00.000Z",
        updatedAt: "2026-10-18T00:00:00.000Z",
      },
    ],
    tree: [
      {
        name: "src",
        path: "src",
        isDirectory: true,
        children: [
          {
            name: "components",
            path: "src/components",
            isDirectory: true,
            children: [{ name: "Hero.tsx", path: HERO_PATH, isDirectory: false }],
          },
        ],
      },
    ],
    sourceGeneration: 1,
    latestPublishedRevision: null,
  } as never);
  return client;
}

/**
 * The shell. The editor's own route stays where it is: a frame naming
 * another page is then a frame showing another page, whatever the editor
 * would do about it.
 */
function renderShell() {
  render(
    <QueryClientProvider client={readyClient()}>
      <VisualEditorShell context={contextOf()} search={search} onSearchChange={vi.fn()} />
    </QueryClientProvider>,
  );
}

function fromPreview(data: Record<string, unknown>) {
  const frame = document.querySelector("iframe");
  act(() => {
    window.dispatchEvent(
      new MessageEvent("message", {
        data: { ...data, previewSession: PREVIEW_SESSION },
        origin: PREVIEW_ORIGIN,
        source: frame?.contentWindow ?? null,
      }),
    );
  });
}

async function flushFrames() {
  await act(async () => {
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  });
}

let canvasRevision = 0;
async function selectHeading() {
  const revision =
    Math.max(
      canvasRevision,
      ...posted.map((m) => (typeof m.selectionRevision === "number" ? m.selectionRevision : 0)),
    ) + 1;
  canvasRevision = revision;
  fromPreview({
    type: "morph:storefront-preview-select-section",
    sectionId: "hero",
    componentType: "hero",
    kind: "heading",
    nodeId: "hero:node:heading",
    sourceFilePath: HERO_PATH,
    sourceLocation: null,
    elementKey: "heading",
    fieldKey: "heading",
    field: "heading",
    fieldPath: "heading",
    descendantFields: [],
    tagName: "h1",
    role: null,
    inputType: null,
    styleRevision: Math.max(
      0,
      ...posted.map((m) => (typeof m.styleRevision === "number" ? m.styleRevision : 0)),
    ),
    className: "",
    isSection: false,
    inspectorOverride: null,
    computedStyle: null,
    parentComputedStyle: null,
    sectionComputedStyle: null,
    selectionRevision: revision,
  });
  await flushFrames();
}

/** Renders, brings the frame up as a live one with `capabilities`, and opens the heading. */
async function openHeading(capabilities: readonly string[] = LIVE_FRAME_CAPABILITIES) {
  renderShell();
  createLiveFrame(FRAME, { capabilities }).ready();
  await selectHeading();
  fireEvent.click(screen.getByRole("button", { name: /^Content$/ }));
  return screen.findByDisplayValue("Welcome");
}

const fieldPosts = (from = 0) => posted.slice(from).filter((message) => message.type === SELECTION_FIELD);

beforeEach(() => {
  posted.length = 0;
  canvasRevision = 0;
  typedFor.sectionId = "hero";
  server = {
    generation: 1,
    sections: [{ id: "hero", type: "hero", enabled: true, props: { heading: "Welcome", subheading: "Summary" } }],
  };
  useThemeWorkspaceStore.setState({
    acceptedGenerations: {},
    observedGenerations: {},
    generations: {},
    workspaces: {},
    files: {},
    activeWorkspaceKey: null,
  });
  useThemeWorkspaceStore.getState().setBaseSourceGeneration(1, {
    storefrontId: "storefront-1",
    themeId: "theme-1",
  });
  updateSectionProps.mockReset();
  updateSectionProps.mockImplementation(async (request: { data: { props: Record<string, unknown> } }) => {
    const section = server.sections[0] as { enabled: boolean; props: Record<string, unknown> };
    for (const [key, value] of Object.entries(request.data.props)) {
      if (key === "enabled") section.enabled = value as boolean;
      else section.props[key] = value;
    }
    server.generation += 1;
    return {
      success: true,
      data: {
        draftGeneration: server.generation,
        droppedProps: [],
        document: { version: 1, sections: JSON.parse(JSON.stringify(server.sections)) },
      },
    };
  });
  getThemeEditor.mockReset();
  getThemeEditor.mockImplementation(async () => ({ success: true, message: "ok", data: contextOf() }));
  vi.spyOn(toast, "error").mockImplementation(() => "");
  vi.spyOn(toast, "success").mockImplementation(() => "");
});

describe("typing into an Inspector field", () => {
  it("E1: the post names the section the Inspector is bound to", async () => {
    const field = await openHeading();
    fireEvent.input(field, { target: { value: "Typed" } });
    expect(fieldPosts()).toEqual([
      {
        type: SELECTION_FIELD,
        sectionId: "hero",
        fieldKey: "heading",
        // The selected top-level field: the Inspector names no nested path.
        fieldPath: null,
        value: "Typed",
      },
    ]);
    expect(screen.queryByText(UNAVAILABLE)).toBeNull();
  });

  it("E2: a frame that did not say it reads the section gets no post, and one quiet status", async () => {
    const info = vi.spyOn(console, "info");
    const field = await openHeading([]);
    fireEvent.input(field, { target: { value: "Typed" } });
    fireEvent.input(field, { target: { value: "Typed more" } });
    expect(fieldPosts()).toEqual([]);
    expect(screen.getAllByText(UNAVAILABLE)).toHaveLength(1);
    expect(
      info.mock.calls.filter(([line]) => String(line).includes("live typing unavailable")),
    ).toHaveLength(1);
    // The field still saves as it always did.
    fireEvent.blur(field);
    await waitFor(() => expect(updateSectionProps).toHaveBeenCalledTimes(1));
    expect(updateSectionProps.mock.calls[0]![0].data.props).toEqual({ heading: "Typed more" });
  });

  it("E3: a capability from the frame's previous ready does not count", async () => {
    const field = await openHeading();
    fireEvent.input(field, { target: { value: "Typed" } });
    expect(fieldPosts()).toHaveLength(1);
    // The frame comes up again (a reload) and no longer says it.
    const before = posted.length;
    createLiveFrame(FRAME, { capabilities: [] }).ready();
    fireEvent.input(field, { target: { value: "Typed after reload" } });
    expect(fieldPosts(before)).toEqual([]);
    expect(screen.getAllByText(UNAVAILABLE)).toHaveLength(1);
  });

  it("E4: typing reported for a section other than the one selected posts nothing", async () => {
    await openHeading();
    typedFor.sectionId = "other";
    fireEvent.click(screen.getByRole("button", { name: "Type for a named section" }));
    expect(fieldPosts()).toEqual([]);
    expect(screen.queryByText(UNAVAILABLE)).toBeNull();
  });

  it("E5: a frame on another page gets no post", async () => {
    const field = await openHeading();
    fireEvent.input(field, { target: { value: "Typed" } });
    expect(fieldPosts()).toHaveLength(1);
    const before = posted.length;
    // The frame moved by itself and names the page it is on now.
    fromPreview({ type: "morph:storefront-preview-structure", nodes: [], routePath: "/pages/elsewhere" });
    fireEvent.input(field, { target: { value: "Typed elsewhere" } });
    expect(fieldPosts(before)).toEqual([]);
    expect(screen.queryByText(UNAVAILABLE)).toBeNull();
  });

  it("E6: a section the editor holds hidden gets no post", async () => {
    const field = await openHeading();
    fireEvent.click(screen.getAllByRole("button", { name: "Hide section hero" })[0]!);
    await waitFor(() => expect(updateSectionProps).toHaveBeenCalledTimes(1));
    const before = posted.length;
    fireEvent.input(field, { target: { value: "Typed while hidden" } });
    expect(fieldPosts(before)).toEqual([]);
  });

  it("E7: with nothing selected, typing reported for a section posts nothing", async () => {
    renderShell();
    createLiveFrame(FRAME).ready();
    fireEvent.click(screen.getByRole("button", { name: "Type for a named section" }));
    expect(fieldPosts()).toEqual([]);
  });
});
