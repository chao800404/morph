import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StorefrontThemeEditorDTO } from "@/lib/storefront/dto/storefront-theme.dto";
import { useThemeWorkspaceStore } from "@/lib/storefront/store/theme-workspace-store";
import type { StorefrontThemeEditorSearch } from "@/lib/validations/storefront-theme";
import { signThemePreviewMedia } from "@/server/storefront/storefront-preview-media.serverFn";
import { storefrontThemeFileQueries } from "../-queries/storefront-theme-files.queries";
import { themePreviewServerQueries } from "../-queries/theme-preview-server.queries";
import { VisualEditorShell } from "./visual-editor-shell";
import { createLiveFrame } from "@/lib/test-utils/preview-frame-handshake";

/**
 * An Inspector text edit while a section's content is still waiting on media
 * signing.
 *
 * A canvas edit posts the whole section to the preview; library media in it
 * is posted unsigned at once and posted again once signed. A declared text
 * field typed in the Inspector, other than the selected one, previews through
 * `update-selection-field` and stages its save with `skipPreviewSync`, so it
 * posts no section content of its own. (The selected field's own box commits
 * on blur through a section post, which already supersedes the late one.) The post that was waiting on signing must then not put the older
 * text back, and the newest text and the signed media must both reach the
 * canvas — with no write beyond the ones the edits make.
 */

const EDITOR_ORIGIN = "http://localhost:3000";
const PREVIEW_ORIGIN = "https://preview.morph.test";
const PREVIEW_SESSION = "5f0f0f6e-6c2e-4f1c-9a3e-0f9a2b7c1d4e";
/** The frame comes up and names its page, as a live one does. */
const liveFrame = createLiveFrame({
  origin: PREVIEW_ORIGIN,
  session: PREVIEW_SESSION,
});
const ASSET = "0b9f3a52-2f7e-4c1a-9d4b-6a1f2e3d4c5b";
const SIGNED_URL = "https://media.morph.test/signed-hero.png";
/** An image field's stored value, as the media picker stores a library asset. */
const STORED_IMAGE = {
  source: "asset",
  mediaType: "image",
  assetId: ASSET,
  url: `/assets/${ASSET}.png`,
  name: "hero.png",
};
const scope = { storefrontId: "storefront-1", themeId: "theme-1" };

const posted: Array<Record<string, unknown>> = [];
const updateSectionProps = vi.hoisted(() => vi.fn());

vi.mock("@/server/storefront/storefront-themes.serverFn", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  updateStorefrontThemeSectionProps: updateSectionProps,
}));
vi.mock("@/server/storefront/storefront-preview-media.serverFn", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  signThemePreviewMedia: vi.fn(),
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

const source = `export const contentFields = {
  heading: { type: "text", label: "Heading" },
  subheading: { type: "text", label: "Subheading" },
  image: { type: "image", label: "Image" }
};
export function Hero({ heading = "Welcome", subheading = "Summary", image }) {
  return <section><h1>{heading}</h1><p>{subheading}</p>{image ? <img src={image.url} alt="" /> : null}</section>;
}`;

const context = {
  previewChannel: { editorOrigin: EDITOR_ORIGIN, sessionId: PREVIEW_SESSION },
  storefront: { id: "storefront-1", name: "Store", domain: null, status: "active" },
  theme: { id: "theme-1", name: "Theme", sourceGeneration: 1 },
  templates: [
    {
      id: "template-1",
      type: "index",
      name: "Home",
      document: {
        version: 1,
        sections: [
          {
            id: "hero",
            type: "hero",
            enabled: true,
            props: { heading: "Welcome", subheading: "Summary", image: STORED_IMAGE },
          },
        ],
      },
      draftGeneration: 1,
      version: 1,
    },
  ],
} as unknown as StorefrontThemeEditorDTO;

const search = {
  template: "index",
  templateId: "template-1",
  viewport: "desktop",
  section: "hero",
} as StorefrontThemeEditorSearch;

const heroNode = {
  id: "hero:node:heading",
  parentId: null,
  sectionId: "hero",
  label: "Heading",
  kind: "heading",
  tagName: "h1",
  target: {
    sectionId: "hero",
    nodeId: "hero:node:heading",
    elementKey: "heading",
    fieldKey: "heading",
    fieldPath: "heading",
    isSection: false,
  },
};

function renderEditor() {
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
        path: "src/components/Hero.tsx",
        content: source,
        mimeType: "text/typescript",
        isEntry: false,
        version: 1,
        createdAt: "2026-10-15T00:00:00.000Z",
        updatedAt: "2026-10-15T00:00:00.000Z",
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
            children: [{ name: "Hero.tsx", path: "src/components/Hero.tsx", isDirectory: false }],
          },
        ],
      },
    ],
    sourceGeneration: 1,
    latestPublishedRevision: null,
  } as never);
  return render(
    <QueryClientProvider client={client}>
      <VisualEditorShell context={context} search={search} onSearchChange={vi.fn()} />
    </QueryClientProvider>,
  );
}

function fromPreview(data: Record<string, unknown>) {
  liveFrame.before(data);
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
  liveFrame.after(data);
}

type Posted = { type: string; sectionId?: string; props?: Record<string, unknown> };
const sectionPosts = (from = 0) =>
  (posted.slice(from) as Posted[]).filter(
    (message) =>
      message.type === "morph:storefront-preview-update-section-props" &&
      message.sectionId === "hero",
  );
const headingOf = (message: Posted | undefined) => message?.props?.heading;
const subheadingOf = (message: Posted | undefined) => message?.props?.subheading;
const imageSigned = (message: Posted | undefined) =>
  JSON.stringify(message?.props?.image ?? null).includes(SIGNED_URL);
const savedProps = () =>
  updateSectionProps.mock.calls.map(
    (call) => (call[0] as { data: { props: Record<string, unknown> } }).data.props,
  );
const saveState = () =>
  document.querySelector("[data-editor-save-status]")?.getAttribute("data-save-state");

/** Signing that answers only when told to. */
let releaseSigning: () => Promise<void> = async () => {};
function signingHeld() {
  const answers: Array<(value: unknown) => void> = [];
  vi.mocked(signThemePreviewMedia).mockImplementation(
    () => new Promise((resolve) => answers.push(resolve)) as never,
  );
  releaseSigning = async () => {
    await act(async () => {
      for (const answer of answers.splice(0)) {
        answer({
          success: true,
          data: { urls: { [ASSET]: SIGNED_URL }, expiresAt: Date.now() + 86_400_000 },
        });
      }
    });
    await settle();
  };
}

const settle = () =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(0);
  });

/** Selects the heading and opens the Inspector's content fields. */
async function openHeading() {
  renderEditor();
  fromPreview({ type: "morph:storefront-preview-structure", nodes: [heroNode] });
  const row = await screen.findByText("h1");
  act(() => {
    row.closest("button")?.click();
  });
  fireEvent.click(screen.getByRole("button", { name: /^Content$/ }));
  await screen.findByDisplayValue("Welcome");
}

/**
 * The canvas reports a selection: the section itself (`null`), or one of its
 * fields. Revisions follow the latest the editor asked for, as the page does.
 */
let canvasRevision = 0;
async function canvasSelect(field: "heading" | null) {
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
    kind: field ? "heading" : "section",
    nodeId: field ? `hero:node:${field}` : "hero",
    sourceFilePath: "src/components/Hero.tsx",
    sourceLocation: null,
    elementKey: field,
    fieldKey: field,
    field,
    fieldPath: field,
    descendantFields: [],
    tagName: field ? "h1" : "section",
    role: null,
    inputType: null,
    styleRevision: Math.max(
      0,
      ...posted.map((m) => (typeof m.styleRevision === "number" ? m.styleRevision : 0)),
    ),
    className: "",
    isSection: field === null,
    inspectorOverride: null,
    computedStyle: null,
    parentComputedStyle: null,
    sectionComputedStyle: null,
    selectionRevision: revision,
  });
  await settle();
}

/** Text finished on the canvas: the whole section is posted, its image unsigned. */
async function canvasEdit(value: string, originalValue: string) {
  fromPreview({
    type: "morph:storefront-preview-commit-inline-text",
    sectionId: "hero",
    fieldKey: "heading",
    fieldPath: "heading",
    value,
    originalValue,
  });
  await settle();
}

/** Text typed into a declared Inspector field that is not the selected one. */
async function inspectorEdit(from: string, to: string) {
  if (!screen.queryByDisplayValue(from)) await canvasSelect(null);
  const field = await screen.findByDisplayValue(from);
  fireEvent.focus(field);
  fireEvent.input(field, { target: { value: to } });
  fireEvent.blur(field);
  await settle();
}

/** Lets debounced saves leave and their answers land. */
async function saveSettles() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(400);
  });
  await settle();
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"], shouldAdvanceTime: true });
  posted.length = 0;
  canvasRevision = 0;
  useThemeWorkspaceStore.setState({
    acceptedGenerations: {},
    observedGenerations: {},
    generations: {},
    workspaces: {},
    files: {},
    activeWorkspaceKey: null,
  });
  useThemeWorkspaceStore.getState().setBaseSourceGeneration(1, scope);
  let generation = 1;
  updateSectionProps.mockReset();
  updateSectionProps.mockImplementation(async () => {
    generation += 1;
    return { success: true, data: { draftGeneration: generation, droppedProps: [] } };
  });
  vi.mocked(signThemePreviewMedia).mockReset();
});

afterEach(async () => {
  cleanup();
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe("an Inspector text edit while the section's media is being signed", () => {
  it("T1: the late signed post does not put the older text back; the newest text and the signed image reach the canvas", async () => {
    signingHeld();
    await openHeading();
    const accepted = useThemeWorkspaceStore.getState().acceptedGenerations;
    await canvasEdit("Edited", "Welcome");
    expect(headingOf(sectionPosts().at(-1))).toBe("Edited");
    expect(subheadingOf(sectionPosts().at(-1))).toBe("Summary");
    expect(imageSigned(sectionPosts().at(-1))).toBe(false);
    expect(signThemePreviewMedia).toHaveBeenCalled();

    const before = posted.length;
    await inspectorEdit("Summary", "Sub newer");
    // The skipPreviewSync path: previewed on the element, no section post.
    expect(sectionPosts(before)).toEqual([]);
    await saveSettles();
    await releaseSigning();

    const after = sectionPosts(before);
    expect(after.map(subheadingOf)).not.toContain("Summary");
    expect(subheadingOf(after.at(-1))).toBe("Sub newer");
    expect(headingOf(after.at(-1))).toBe("Edited");
    expect(imageSigned(after.at(-1))).toBe(true);

    // T5: what the edits wrote is stored, once; no other write, no baseline moved.
    await saveSettles();
    await waitFor(() => expect(saveState()).toBe("saved"));
    expect(savedProps()).toHaveLength(1);
    expect(savedProps()[0]).toMatchObject({ heading: "Edited", subheading: "Sub newer" });
    expect(useThemeWorkspaceStore.getState().acceptedGenerations).toEqual(accepted);
  });

  it("T2: with the media already signed, an Inspector text edit posts no section content", async () => {
    signingHeld();
    await openHeading();
    await canvasEdit("Edited", "Welcome");
    await releaseSigning();
    // Signed and shown: the second post carried the signed image.
    expect(imageSigned(sectionPosts().at(-1))).toBe(true);

    const before = posted.length;
    await inspectorEdit("Summary", "Sub newer");
    await saveSettles();
    await releaseSigning();
    expect(sectionPosts(before)).toEqual([]);
    await waitFor(() => expect(saveState()).toBe("saved"));
    expect(savedProps().at(-1)).toMatchObject({ subheading: "Sub newer" });
  });

  it("T2b: with media in the section but no post waiting on signing, an Inspector text edit posts and signs nothing", async () => {
    signingHeld();
    await openHeading();
    const before = posted.length;
    await inspectorEdit("Summary", "Sub newer");
    await saveSettles();
    await releaseSigning();
    expect(sectionPosts(before)).toEqual([]);
    expect(signThemePreviewMedia).not.toHaveBeenCalled();
    await waitFor(() => expect(saveState()).toBe("saved"));
    expect(savedProps()).toHaveLength(1);
    expect(savedProps()[0]).toMatchObject({ subheading: "Sub newer" });
  });

  it("T3: several Inspector edits while signing end in one post, with the last text", async () => {
    signingHeld();
    await openHeading();
    await canvasEdit("Edited", "Welcome");
    const before = posted.length;
    await inspectorEdit("Summary", "Sub newer");
    await inspectorEdit("Sub newer", "Sub newest");
    await saveSettles();
    await releaseSigning();

    const after = sectionPosts(before);
    expect(after).toHaveLength(1);
    expect(subheadingOf(after[0])).toBe("Sub newest");
    expect(imageSigned(after[0])).toBe(true);
  });

  it("T4: a later canvas edit still supersedes an Inspector edit's pending post", async () => {
    signingHeld();
    await openHeading();
    await canvasEdit("Edited", "Welcome");
    await inspectorEdit("Summary", "Sub newer");
    const before = posted.length;
    // Before the debounced save leaves: the held copy is "Edited".
    await canvasSelect("heading");
    await canvasEdit("Final", "Edited");
    expect(headingOf(sectionPosts(before).at(-1))).toBe("Final");
    expect(subheadingOf(sectionPosts(before).at(-1))).toBe("Sub newer");
    await saveSettles();
    await releaseSigning();

    const after = sectionPosts(before);
    expect(after.map(headingOf).filter((heading) => heading !== "Final")).toEqual([]);
    expect(after.map(subheadingOf).filter((sub) => sub !== "Sub newer")).toEqual([]);
    expect(imageSigned(after.at(-1))).toBe(true);
  });
});
