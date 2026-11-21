import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StorefrontThemeEditorDTO } from "@/lib/storefront/dto/storefront-theme.dto";
import { useThemeWorkspaceStore } from "@/lib/storefront/store/theme-workspace-store";
import type { StorefrontThemeEditorSearch } from "@/lib/validations/storefront-theme";
import {
  answerLatestRouteRequest,
  createLiveFrame,
  disablePresentationAcks,
  enablePresentationAcks,
  frameEnvelope,
  reloadFrameDocument,
  sendFrameReady,
} from "@/lib/test-utils/preview-frame-handshake";
import { storefrontThemeFileQueries } from "../-queries/storefront-theme-files.queries";
import { themePreviewServerQueries } from "../-queries/theme-preview-server.queries";
import {
  PREVIEW_PRESENTATION_ACK_RESEND_AFTER_MS,
  PREVIEW_PRESENTATION_UNCONFIRMABLE_MESSAGE,
  VisualEditorShell,
} from "./visual-editor-shell";

/**
 * A frame that names section-presentation-ack-v1 but never confirms what it
 * shows (CI run 44664487068: writes stayed paused for 60 s with no notice).
 * The editor re-sends the presentation of the sections still unconfirmed,
 * once, to the same frame, document and ready round; if that is not
 * confirmed either, it says this preview cannot confirm what it shows and
 * offers Reload preview. Writes stay paused and the draft is kept
 * throughout; the re-send is a preview message, never a write.
 *
 * Same harness as `visual-editor-shell-presentation-trace`. Timers are faked
 * from just before the replay, advancing with real time too, so the frame's
 * own message pump keeps running.
 */

const EDITOR_ORIGIN = "http://localhost:3000";
const PREVIEW_ORIGIN = "https://preview.morph.test";
const PREVIEW_SESSION = "5f0f0f6e-6c2e-4f1c-9a3e-0f9a2b7c1d4e";
const ADDRESS = { origin: PREVIEW_ORIGIN, session: PREVIEW_SESSION };
const liveFrame = createLiveFrame(ADDRESS, { answerReady: false });
const HERO_PATH = "src/components/Hero.tsx";
const SECTION_IDS = ["hero-1", "hero-2"];
const DRAFT = "Kept draft";
const PAUSED = /Content writes are paused until every section confirms/;
/** The wait this change documents (`PREVIEW_PRESENTATION_ACK_RESEND_AFTER_MS`). */
const WAIT_MS = 8_000;

const posted: Array<Record<string, unknown>> = [];
const updateSectionProps = vi.hoisted(() =>
  vi.fn(() => new Promise<never>(() => {})),
);
const getThemeEditor = vi.hoisted(() => vi.fn());

vi.mock(
  "@/server/storefront/storefront-themes.serverFn",
  async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    updateStorefrontThemeSectionProps: updateSectionProps,
    getStorefrontThemeEditor: getThemeEditor,
  }),
);

vi.mock("@/lib/storefront/editor/preview-protocol", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  postEditorToPreviewMessage: vi.fn(
    (_target: unknown, message: Record<string, unknown>) => {
      posted.push(message);
    },
  ),
}));

vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  Link: ({
    to,
    children,
    ...rest
  }: {
    to?: string;
    children?: React.ReactNode;
  }) => (
    <a href={to} {...rest}>
      {children}
    </a>
  ),
}));

const source = `export const contentFields = {
  heading: { type: "text", label: "Heading" },
};
export function Hero({ heading = "Welcome" }) {
  return <section><h1 data-morph-node="heading" className="text-4xl">{heading}</h1></section>;
}`;

const scope = { storefrontId: "storefront-1", themeId: "theme-1" };

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
        sections: SECTION_IDS.map((id, index) => ({
          id,
          type: "hero",
          enabled: true,
          props: { heading: `Stored heading ${index + 1}` },
        })),
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
} as StorefrontThemeEditorSearch;

function readyClient() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  client.setQueryData(
    themePreviewServerQueries.forTheme("storefront-1", "theme-1").queryKey,
    {
      success: true,
      message: "Live Preview server ready",
      data: { url: `${PREVIEW_ORIGIN}/store/1/themes/1/preview` },
    } as never,
  );
  client.setQueryData(
    storefrontThemeFileQueries.tree("storefront-1", "theme-1").queryKey,
    {
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
          createdAt: "2026-08-20T00:00:00.000Z",
          updatedAt: "2026-08-20T00:00:00.000Z",
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
    } as never,
  );
  return client;
}

function fromPreview(data: Record<string, unknown>) {
  liveFrame.before(data);
  const frame = document.querySelector("iframe");
  act(() => {
    window.dispatchEvent(
      new MessageEvent("message", {
        data: frameEnvelope({ ...data, previewSession: PREVIEW_SESSION }),
        origin: PREVIEW_ORIGIN,
        source: frame?.contentWindow ?? null,
      }),
    );
  });
  liveFrame.after(data);
}

/** A message from a document no longer active in the frame. */
function fromOldDocument(data: Record<string, unknown>, previewDocument: string) {
  const frame = document.querySelector("iframe");
  act(() => {
    window.dispatchEvent(
      new MessageEvent("message", {
        data: { ...data, previewSession: PREVIEW_SESSION, previewDocument },
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

/** Moves the faked clock on, with React and microtasks settled. */
async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

let lines: string[] = [];

type TokenPost = {
  sectionId: string;
  props?: { heading?: unknown };
  presentationToken: { operationId: string } & Record<string, unknown>;
};
/** The posts that carried a token, since `from`. */
const tokenPosts = (from = 0) =>
  posted
    .slice(from)
    .filter(
      (message) =>
        message.type === "morph:storefront-preview-update-section-props" &&
        message.presentationToken !== undefined,
    ) as TokenPost[];

function renderShell() {
  render(
    <QueryClientProvider client={readyClient()}>
      <VisualEditorShell context={context} search={search} onSearchChange={vi.fn()} />
    </QueryClientProvider>,
  );
}

/**
 * The frame comes up and confirms nothing; a draft is typed and left before
 * its route is answered, so the first replay carries it. Returns the
 * replay's posts.
 */
async function frameThatNeverAnswers() {
  // Every timer the shell starts is on the faked clock, which also moves
  // with real time, so the frame's message pump and the tests' waits run.
  vi.useFakeTimers({
    toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"],
    shouldAdvanceTime: true,
  });
  renderShell();
  await flushFrames();
  sendFrameReady(ADDRESS);
  disablePresentationAcks();
  fromPreview({ type: "morph:storefront-preview-structure", nodes: [], routePath: "/" });
  await flushFrames();
  fireEvent.click(screen.getAllByTitle("Select hero; drag to reorder")[0]!);
  await flushFrames();
  fireEvent.click(screen.getByRole("button", { name: /^Content$/ }));
  await flushFrames();
  const field = await screen.findByDisplayValue("Stored heading 1");
  fireEvent.input(field, { target: { value: DRAFT } });
  fireEvent.blur(field);
  await flushFrames();
  const before = posted.length;
  answerLatestRouteRequest(ADDRESS);
  const replay = tokenPosts(before);
  expect(new Set(replay.map((post) => post.sectionId))).toEqual(new Set(SECTION_IDS));
  expect(
    replay.find((post) => post.sectionId === "hero-1")?.props?.heading,
    "the replay carries the draft",
  ).toBe(DRAFT);
  return replay;
}

const unconfirmable = () => screen.queryByTestId("preview-presentation-unconfirmable");
const draftField = () => screen.getByDisplayValue(DRAFT) as HTMLInputElement;

beforeEach(() => {
  posted.length = 0;
  lines = [];
  updateSectionProps.mockClear();
  getThemeEditor.mockResolvedValue({ success: true, data: context });
  vi.spyOn(console, "info").mockImplementation((...args: unknown[]) => {
    lines.push(args.map(String).join(" "));
  });
  useThemeWorkspaceStore.setState({
    acceptedGenerations: {},
    observedGenerations: {},
    generations: {},
    workspaces: {},
    files: {},
    activeWorkspaceKey: null,
  });
  useThemeWorkspaceStore.getState().setBaseSourceGeneration(1, scope);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("a frame that can acknowledge but does not", () => {
  it("waits 8 s before each step", () => {
    expect(PREVIEW_PRESENTATION_ACK_RESEND_AFTER_MS).toBe(WAIT_MS);
  });

  it("(a) never answers: one re-send of the unconfirmed sections, then the cannot-confirm notice; writes stay paused and the draft is kept", async () => {
    const replay = await frameThatNeverAnswers();
    const afterReplay = posted.length;

    // Half way through the wait: nothing is sent again. (The faked clock
    // also moves with real time, so the checks keep a margin.)
    await advance(WAIT_MS / 2);
    expect(tokenPosts(afterReplay)).toHaveLength(0);
    expect(screen.getByText(PAUSED)).toBeTruthy();

    // The wait runs out: the same sections are presented again, once, with
    // new tokens, the draft still on top.
    await advance(WAIT_MS / 2 + 500);
    const resend = tokenPosts(afterReplay);
    expect(resend.map((post) => post.sectionId).sort()).toEqual([...SECTION_IDS].sort());
    for (const post of resend) {
      expect(
        replay.some(
          (first) =>
            first.presentationToken.operationId === post.presentationToken.operationId,
        ),
      ).toBe(false);
    }
    expect(resend.find((post) => post.sectionId === "hero-1")?.props?.heading).toBe(DRAFT);
    expect(unconfirmable()).toBeNull();

    // Still nothing: the preview cannot confirm what it shows.
    await advance(WAIT_MS + 100);
    expect(unconfirmable()?.textContent).toContain(PREVIEW_PRESENTATION_UNCONFIRMABLE_MESSAGE);
    expect(screen.getByRole("button", { name: "Reload preview" })).toBeTruthy();

    // And it is never sent a third time, nothing is written, the draft stays.
    const afterResend = posted.length;
    await advance(WAIT_MS * 3);
    expect(tokenPosts(afterResend)).toHaveLength(0);
    expect(updateSectionProps).not.toHaveBeenCalled();
    expect(draftField().disabled).toBe(true);
    expect(draftField().value).toBe(DRAFT);
    expect(
      lines.filter((line) => line.includes("ack wait expired")),
    ).toHaveLength(2);
  });

  it("(b) the re-send is confirmed: writes resume, after exactly one re-send", async () => {
    await frameThatNeverAnswers();
    const afterReplay = posted.length;
    // The first presentation goes unanswered; from half way through the wait
    // the frame answers what it is sent from then on.
    await advance(WAIT_MS / 2);
    expect(tokenPosts(afterReplay)).toHaveLength(0);
    expect(screen.getByText(PAUSED)).toBeTruthy();
    enablePresentationAcks(ADDRESS);
    await advance(WAIT_MS / 2 + 500);
    const resend = tokenPosts(afterReplay);
    expect(resend.map((post) => post.sectionId).sort()).toEqual([...SECTION_IDS].sort());
    await advance(100);

    expect(screen.queryByText(PAUSED), lines.slice(-16).join("\n")).toBeNull();
    expect(unconfirmable()).toBeNull();
    expect(draftField().value).toBe(DRAFT);

    const afterResend = posted.length;
    await advance(WAIT_MS * 3);
    expect(
      tokenPosts(afterResend).filter((post) =>
        resend.some((sent) => sent.sectionId === post.sectionId),
      ).length,
      "no second re-send",
    ).toBe(0);
    expect(unconfirmable()).toBeNull();
    expect(
      lines.filter((line) => line.includes("ack wait expired")),
    ).toHaveLength(1);
  });

  it("(c) after the frame's document changes, a late answer for the old document's round is ignored and unlocks nothing", async () => {
    const replay = await frameThatNeverAnswers();
    const oldDocument = String((frameEnvelope({}) as { previewDocument?: unknown }).previewDocument);
    const late = replay[0]!;

    // The page reloads itself before the wait runs out: a new document,
    // a new ready round, which confirms nothing either.
    await advance(WAIT_MS / 2);
    reloadFrameDocument();
    sendFrameReady(ADDRESS);
    disablePresentationAcks();
    const afterReload = posted.length;
    fromPreview({ type: "morph:storefront-preview-structure", nodes: [], routePath: "/" });
    answerLatestRouteRequest(ADDRESS);
    await advance(50);
    fromPreview({ type: "morph:storefront-preview-structure", nodes: [], routePath: "/" });
    await advance(50);

    // The old document's late answer, from the old document: not taken.
    fromOldDocument(
      {
        type: "morph:storefront-preview-section-presentation-ack",
        operationId: late.presentationToken.operationId,
        token: late.presentationToken,
        status: "applied",
      },
      oldDocument,
    );
    // The same answer relayed by the new document: no longer waited on.
    fromPreview({
      type: "morph:storefront-preview-section-presentation-ack",
      operationId: late.presentationToken.operationId,
      token: late.presentationToken,
      status: "applied",
    });
    expect(
      lines.some(
        (line) =>
          line.includes(`ack rejected op=${late.presentationToken.operationId} `) &&
          line.includes("guard=no-pending round=2 "),
      ),
    ).toBe(true);
    expect(screen.getByText(PAUSED)).toBeTruthy();

    // The old round's wait is over with its round: nothing is re-sent for it.
    // The new round's own wait runs as any round's does: one re-send, then
    // the notice; the old answer never confirms it.
    const roundTwo = tokenPosts(afterReload);
    await advance(WAIT_MS + 100);
    const resend = tokenPosts(afterReload).slice(roundTwo.length);
    expect(
      resend.every(
        (post) =>
          !replay.some(
            (first) =>
              first.presentationToken.operationId === post.presentationToken.operationId,
          ),
      ),
    ).toBe(true);
    expect(
      new Set(roundTwo.map((post) => post.sectionId)),
      "the new round was presented the page, and confirms nothing",
    ).toEqual(new Set(SECTION_IDS));
    expect(resend.map((post) => post.sectionId).sort()).toEqual([...SECTION_IDS].sort());
    fromPreview({
      type: "morph:storefront-preview-section-presentation-ack",
      operationId: late.presentationToken.operationId,
      token: late.presentationToken,
      status: "applied",
    });
    expect(screen.getByText(PAUSED)).toBeTruthy();
    await advance(WAIT_MS + 100);
    expect(unconfirmable()?.textContent).toContain(
      PREVIEW_PRESENTATION_UNCONFIRMABLE_MESSAGE,
    );
    expect(updateSectionProps).not.toHaveBeenCalled();
    expect(draftField().value).toBe(DRAFT);
    // Round 1's wait never fired after its round ended.
    expect(
      lines.filter(
        (line) => line.includes("ack wait expired") && line.includes(" round=1 "),
      ),
    ).toHaveLength(0);
  });

  it("(d) after the notice, a valid answer for the same frame, document and round clears it and sends the held draft once; answers from elsewhere do not", async () => {
    const replay = await frameThatNeverAnswers();
    const afterReplay = posted.length;
    await advance(WAIT_MS + 500);
    const resend = tokenPosts(afterReplay);
    expect(resend.map((post) => post.sectionId).sort()).toEqual([...SECTION_IDS].sort());
    await advance(WAIT_MS + 100);
    expect(unconfirmable()?.textContent).toContain(PREVIEW_PRESENTATION_UNCONFIRMABLE_MESSAGE);
    expect(updateSectionProps).not.toHaveBeenCalled();
    const ack = (post: TokenPost) => ({
      type: "morph:storefront-preview-section-presentation-ack",
      operationId: post.presentationToken.operationId,
      token: post.presentationToken,
      status: "applied",
    });

    // Control: the re-sent tokens answered from a document the frame does
    // not show, and the first round of tokens (no longer waited on) answered
    // by the frame itself. Neither clears the notice or sends anything.
    const otherDocument = "f".repeat(32);
    expect(
      String((frameEnvelope({}) as { previewDocument?: unknown }).previewDocument),
    ).not.toBe(otherDocument);
    for (const post of resend) fromOldDocument(ack(post), otherDocument);
    for (const post of replay) fromPreview(ack(post));
    await advance(100);
    expect(unconfirmable()?.textContent).toContain(PREVIEW_PRESENTATION_UNCONFIRMABLE_MESSAGE);
    expect(draftField().disabled).toBe(true);
    expect(updateSectionProps).not.toHaveBeenCalled();

    // The valid answer: the re-sent tokens, from this frame's document, in
    // this round. The notice clears, the page is established, and the held
    // draft is written exactly once.
    for (const post of resend) fromPreview(ack(post));
    await advance(100);
    expect(unconfirmable(), lines.slice(-16).join("\n")).toBeNull();
    // Established: no paused reason of either kind is shown any more.
    expect(screen.queryByText(PAUSED)).toBeNull();
    expect(
      screen.queryAllByText(PREVIEW_PRESENTATION_UNCONFIRMABLE_MESSAGE, { exact: false }),
    ).toHaveLength(0);
    expect(lines.some((line) => line.includes("page confirmed after re-send"))).toBe(true);
    expect(updateSectionProps).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(updateSectionProps.mock.calls[0])).toContain(DRAFT);

    await advance(WAIT_MS * 3);
    expect(updateSectionProps).toHaveBeenCalledTimes(1);
    expect(unconfirmable()).toBeNull();
    expect(draftField().value).toBe(DRAFT);
  });
});
