/**
 * Style replay resend and stored-replay ownership, the Edit replay control, and inline edits of text the Theme changed.
 *
 * One of the files the former `visual-editor-shell-round-trip.test.tsx` was split into so
 * the test shards can spread it; the shared setup is in `visual-editor-shell-round-trip.harness.tsx`.
 */
import {
  PREVIEW_ORIGIN,
  PREVIEW_SESSION,
  STYLE_AFTER,
  STYLE_REMOTE,
  STYLE_SOURCE,
  applyStylePatch,
  baseSearch,
  captureCodeFileSave,
  commitInlineText,
  controlledThemeFile,
  createEditHistoryEntry,
  editorHolding,
  flushFrames,
  fromPreview,
  localThemeFile,
  messagesOfType,
  posted,
  readyQueryClient,
  renderShell,
  renderShellWithHero,
  saveStatus,
  selectHeading,
  sendInlineCommit,
  stylePatchTarget,
  themeFileQueueControl,
  updateSectionProps,
} from "./visual-editor-shell-round-trip.harness";
import { QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { toast } from "sonner";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  StorefrontThemeEditorDTO,
} from "@/lib/storefront/dto/storefront-theme.dto";
import {
  useThemeWorkspaceStore,
} from "@/lib/storefront/store/theme-workspace-store";
import {
  useEditorWriteGateStore,
} from "@/lib/storefront/store/editor-write-gate-store";
import {
  INLINE_TEXT_NOT_SAVED_MESSAGE,
  INLINE_TEXT_REFUSED_MESSAGE,
  VisualEditorShell,
} from "./visual-editor-shell";

/**
 * Who may use a stored Style replay (its receipt, its basis) once its answer
 * was lost: the same history run, or the author's explicit save of exactly its
 * text (Check and save). Any other save of the file settles it from read-back
 * evidence or leaves it unused; nothing else inherits its receipt.
 */
describe("Style replay resend and stored-replay ownership", () => {
  const UUID =
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const CODE_EDIT = STYLE_SOURCE + "\n// typed in Code";
  const scope = { storefrontId: "storefront-1", themeId: "theme-1" };

  beforeEach(() => {
    useThemeWorkspaceStore.setState({ workspaces: {} });
    stylePatchTarget.filePath = "src/components/Hero.tsx";
    stylePatchTarget.elementName = "section";
  });

  async function applyAndSaveStyle(
    server: ReturnType<typeof controlledThemeFile>,
    expectedWrites = 1,
  ) {
    applyStylePatch();
    await waitFor(() =>
      expect(server.save).toHaveBeenCalledTimes(expectedWrites),
    );
    await waitFor(() => expect(localThemeFile()?.saveState).toBe("clean"));
  }

  const historyState = () => ({
    undoAvailable: !screen
      .getByRole("button", { name: "Undo" })
      .hasAttribute("disabled"),
    redoAvailable: !screen
      .getByRole("button", { name: "Redo" })
      .hasAttribute("disabled"),
  });

  type SentWrite = {
    content?: string;
    writeAttemptId?: string;
    expectedFileId?: string;
    expectedVersion?: number;
    expectedSourceGeneration?: number;
  };
  const sentWrite = (
    server: ReturnType<typeof controlledThemeFile>,
    index: number,
  ): SentWrite =>
    ((server.save.mock.calls[index]?.[0] as { data?: SentWrite } | undefined)
      ?.data ?? {}) as SentWrite;
  const basisOf = (write: SentWrite) => ({
    content: write.content,
    writeAttemptId: write.writeAttemptId,
    expectedFileId: write.expectedFileId,
    expectedVersion: write.expectedVersion,
    expectedSourceGeneration: write.expectedSourceGeneration,
  });
  // Both Style history refusals ("... while confirming Style history", "...
  // during Style history recovery") start with this.
  const historyConflictToasts = (error: {
    mock: { calls: ReadonlyArray<ReadonlyArray<unknown>> };
  }) =>
    error.mock.calls.filter(([message]) =>
      String(message).includes("The Theme file or source changed"),
    ).length;

  async function finishCheck() {
    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: "Check and save" }),
      ).not.toBeNull(),
    );
  }

  it("checks and resends a lost Code save once when the file retains a prior replay receipt", async () => {
    const server = controlledThemeFile(STYLE_SOURCE);
    renderShellWithHero(STYLE_SOURCE);
    await applyAndSaveStyle(server);
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    await waitFor(() => expect(server.file().lastWriteAttemptId).toMatch(UUID));
    const previousReceipt = server.file().lastWriteAttemptId;

    const saveFile = await captureCodeFileSave();
    server.outcomes.push("offline");
    await act(async () => {
      await saveFile(stylePatchTarget.filePath, CODE_EDIT).catch(() => {});
    });
    await waitFor(() =>
      expect(localThemeFile()?.unconfirmedContent).toBe(CODE_EDIT),
    );
    expect(server.file().lastWriteAttemptId).toBe(previousReceipt);
    expect(server.save).toHaveBeenCalledTimes(3);

    fireEvent.click(screen.getByRole("button", { name: "Check and save" }));
    await waitFor(() => expect(server.save).toHaveBeenCalledTimes(4));
    await waitFor(() =>
      expect(localThemeFile()?.unconfirmedContent).toBeUndefined(),
    );
    expect(sentWrite(server, 3).content).toBe(CODE_EDIT);
    expect(sentWrite(server, 3).writeAttemptId).toBeUndefined();
    expect(server.file().content).toBe(CODE_EDIT);
  });

  it("resends a proven not-landed Style Undo once with its own receipt and basis, then confirms it", async () => {
    const server = controlledThemeFile(STYLE_SOURCE);
    renderShellWithHero(STYLE_SOURCE);
    await applyAndSaveStyle(server);
    const error = vi.spyOn(toast, "error").mockImplementation(() => "");
    server.outcomes.push("offline");

    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    await waitFor(() =>
      expect(localThemeFile()?.unconfirmedContent).toBe(STYLE_SOURCE),
    );
    const lost = sentWrite(server, 1);
    expect(lost.writeAttemptId).toMatch(UUID);
    expect(server.file()).toMatchObject({
      content: STYLE_AFTER,
      version: 2,
      sourceGeneration: 2,
      lastWriteAttemptId: null,
    });

    fireEvent.click(screen.getByRole("button", { name: "Check and save" }));
    await waitFor(() => expect(server.save).toHaveBeenCalledTimes(3));
    await waitFor(() =>
      expect(localThemeFile()?.unconfirmedContent).toBeUndefined(),
    );

    expect(basisOf(sentWrite(server, 2))).toEqual(basisOf(lost));
    expect(basisOf(lost)).toEqual({
      content: STYLE_SOURCE,
      writeAttemptId: lost.writeAttemptId,
      expectedFileId: "file-hero",
      expectedVersion: 2,
      expectedSourceGeneration: 2,
    });
    await waitFor(() =>
      expect(historyState()).toEqual({
        undoAvailable: false,
        redoAvailable: true,
      }),
    );
    expect({
      writes: server.save.mock.calls.length,
      file: server.file(),
      conflict: localThemeFile()?.conflict,
      sourceConflict: localThemeFile()?.sourceConflict ?? false,
      historyConflictToasts: historyConflictToasts(error),
    }).toMatchObject({
      writes: 3,
      file: {
        content: STYLE_SOURCE,
        version: 3,
        sourceGeneration: 3,
        lastWriteAttemptId: lost.writeAttemptId,
      },
      conflict: undefined,
      sourceConflict: false,
      historyConflictToasts: 0,
    });
  });

  it("keeps a lost resend of a not-landed Style Undo tracked, and the next check confirms it by its receipt", async () => {
    const server = controlledThemeFile(STYLE_SOURCE);
    renderShellWithHero(STYLE_SOURCE);
    await applyAndSaveStyle(server);
    const error = vi.spyOn(toast, "error").mockImplementation(() => "");
    server.outcomes.push("offline");

    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    await waitFor(() =>
      expect(localThemeFile()?.unconfirmedContent).toBe(STYLE_SOURCE),
    );
    const lost = sentWrite(server, 1);

    server.outcomes.push("offline-after-landing");
    fireEvent.click(screen.getByRole("button", { name: "Check and save" }));
    await waitFor(() => expect(server.save).toHaveBeenCalledTimes(3));
    await finishCheck();
    expect(basisOf(sentWrite(server, 2))).toEqual(basisOf(lost));
    expect({
      unconfirmed: localThemeFile()?.unconfirmedContent,
      history: historyState(),
      file: server.file(),
    }).toMatchObject({
      unconfirmed: STYLE_SOURCE,
      history: { undoAvailable: true, redoAvailable: false },
      file: {
        content: STYLE_SOURCE,
        version: 3,
        sourceGeneration: 3,
        lastWriteAttemptId: lost.writeAttemptId,
      },
    });

    fireEvent.click(screen.getByRole("button", { name: "Check and save" }));
    await waitFor(() => expect(server.read).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(localThemeFile()?.unconfirmedContent).toBeUndefined(),
    );
    await waitFor(() =>
      expect(historyState()).toEqual({
        undoAvailable: false,
        redoAvailable: true,
      }),
    );
    expect({
      writes: server.save.mock.calls.length,
      conflict: localThemeFile()?.conflict,
      historyConflictToasts: historyConflictToasts(error),
    }).toEqual({ writes: 3, conflict: undefined, historyConflictToasts: 0 });
  });

  it("does not confirm a lost Redo from an earlier Undo's receipt; resends the Redo once under its own receipt", async () => {
    const server = controlledThemeFile(STYLE_SOURCE);
    renderShellWithHero(STYLE_SOURCE);
    await applyAndSaveStyle(server);
    const error = vi.spyOn(toast, "error").mockImplementation(() => "");

    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    await waitFor(() => expect(server.save).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(historyState().redoAvailable).toBe(true));
    const undoReceipt = sentWrite(server, 1).writeAttemptId;
    expect(server.file().lastWriteAttemptId).toBe(undoReceipt);

    server.outcomes.push("offline");
    fireEvent.click(screen.getByRole("button", { name: "Redo" }));
    await waitFor(() =>
      expect(localThemeFile()?.unconfirmedContent).toBe(STYLE_AFTER),
    );
    const lostRedo = sentWrite(server, 2);
    expect(lostRedo.writeAttemptId).toMatch(UUID);
    expect(lostRedo.writeAttemptId).not.toBe(undoReceipt);
    // The file still holds the landed Undo's receipt: an earlier attempt's.
    expect(server.file()).toMatchObject({
      content: STYLE_SOURCE,
      version: 3,
      lastWriteAttemptId: undoReceipt,
    });

    fireEvent.click(screen.getByRole("button", { name: "Check and save" }));
    await waitFor(() => expect(server.read).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(server.save).toHaveBeenCalledTimes(4));
    await waitFor(() =>
      expect(localThemeFile()?.unconfirmedContent).toBeUndefined(),
    );
    expect(basisOf(sentWrite(server, 3))).toEqual(basisOf(lostRedo));
    expect(basisOf(lostRedo)).toMatchObject({
      content: STYLE_AFTER,
      expectedVersion: 3,
      expectedSourceGeneration: 3,
    });
    await waitFor(() =>
      expect(historyState()).toEqual({
        undoAvailable: true,
        redoAvailable: false,
      }),
    );
    expect({
      writes: server.save.mock.calls.length,
      file: server.file(),
      conflict: localThemeFile()?.conflict,
      historyConflictToasts: historyConflictToasts(error),
    }).toMatchObject({
      writes: 4,
      file: {
        content: STYLE_AFTER,
        version: 4,
        lastWriteAttemptId: lostRedo.writeAttemptId,
      },
      conflict: undefined,
      historyConflictToasts: 0,
    });
  });

  it("does not let a stored not-landed Style replay lend its receipt to a later save or run", async () => {
    const server = controlledThemeFile(STYLE_SOURCE);
    renderShellWithHero(STYLE_SOURCE);
    await applyAndSaveStyle(server);
    server.outcomes.push("offline");

    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    await waitFor(() =>
      expect(localThemeFile()?.unconfirmedContent).toBe(STYLE_SOURCE),
    );
    const lost = sentWrite(server, 1);

    // An ordinary save of other text of the same file, asked for by the
    // author: read back first, then sent as a plain save.
    const saveFile = await captureCodeFileSave();
    let codeSaveError: unknown;
    await act(async () => {
      await saveFile(stylePatchTarget.filePath, CODE_EDIT, {
        confirmed: true,
      }).catch((e: unknown) => {
        codeSaveError = e;
      });
    });
    expect(codeSaveError).toBeUndefined();
    expect(server.read).toHaveBeenCalledTimes(1);
    expect(basisOf(sentWrite(server, 2))).toEqual({
      content: CODE_EDIT,
      writeAttemptId: undefined,
      expectedFileId: "file-hero",
      expectedVersion: 2,
      expectedSourceGeneration: 2,
    });
    expect(server.file().lastWriteAttemptId).toBeNull();
    expect(localThemeFile()?.unconfirmedContent).toBeUndefined();

    // Undo the Code edit, then run the Style Undo again: a new run with a
    // receipt of its own, not the lost attempt's.
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    await waitFor(() => expect(server.save).toHaveBeenCalledTimes(4));
    await waitFor(() => expect(localThemeFile()?.saveState).toBe("clean"));
    await waitFor(() => expect(historyState().undoAvailable).toBe(true));
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    await waitFor(() => expect(server.save).toHaveBeenCalledTimes(5));
    await waitFor(() => expect(localThemeFile()?.saveState).toBe("clean"));

    const rerun = sentWrite(server, 4);
    expect(rerun.writeAttemptId).toMatch(UUID);
    expect(rerun.writeAttemptId).not.toBe(lost.writeAttemptId);
    expect(server.file().lastWriteAttemptId).toBe(rerun.writeAttemptId);
  });

  it("settles a stored landed Style replay from its receipt when another save of the file goes first", async () => {
    const server = controlledThemeFile(STYLE_SOURCE);
    renderShellWithHero(STYLE_SOURCE);
    await applyAndSaveStyle(server);
    server.outcomes.push("offline-after-landing");

    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    await waitFor(() =>
      expect(localThemeFile()?.unconfirmedContent).toBe(STYLE_SOURCE),
    );
    const lost = sentWrite(server, 1);
    expect(server.file().lastWriteAttemptId).toBe(lost.writeAttemptId);

    const saveFile = await captureCodeFileSave();
    let codeSaveError: unknown;
    await act(async () => {
      await saveFile(stylePatchTarget.filePath, CODE_EDIT, {
        confirmed: true,
      }).catch((e: unknown) => {
        codeSaveError = e;
      });
    });
    expect(codeSaveError).toBeUndefined();
    expect(basisOf(sentWrite(server, 2))).toEqual({
      content: CODE_EDIT,
      writeAttemptId: undefined,
      expectedFileId: "file-hero",
      expectedVersion: 3,
      expectedSourceGeneration: 3,
    });
    expect({
      writes: server.save.mock.calls.length,
      receipt: server.file().lastWriteAttemptId,
      unconfirmed: localThemeFile()?.unconfirmedContent,
      conflict: localThemeFile()?.conflict,
    }).toEqual({
      writes: 3,
      receipt: null,
      unconfirmed: undefined,
      conflict: undefined,
    });

    // The Style Undo was confirmed by its receipt: undoing the Code edit
    // leaves nothing older to undo.
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    await waitFor(() => expect(server.save).toHaveBeenCalledTimes(4));
    await waitFor(() =>
      expect(historyState()).toEqual({
        undoAvailable: false,
        redoAvailable: true,
      }),
    );
    expect(server.file().content).toBe(STYLE_SOURCE);
  });

  it.each(["offline", "offline-after-landing"] as const)(
    "refuses another history run of the file while a Style replay is stored (%s), then Check and save settles it",
    async (lostOutcome) => {
      const server = controlledThemeFile(STYLE_SOURCE);
      renderShellWithHero(STYLE_SOURCE);
      await applyAndSaveStyle(server);
      await applyAndSaveStyle(server, 2);
      const secondAfter = server.file().content;
      expect(secondAfter).not.toBe(STYLE_AFTER);

      fireEvent.click(screen.getByRole("button", { name: "Undo" }));
      await waitFor(() => expect(server.save).toHaveBeenCalledTimes(3));
      await waitFor(() => expect(server.file().content).toBe(STYLE_AFTER));
      await waitFor(() =>
        expect(historyState()).toEqual({
          undoAvailable: true,
          redoAvailable: true,
        }),
      );

      server.outcomes.push(lostOutcome);
      fireEvent.click(screen.getByRole("button", { name: "Undo" }));
      await waitFor(() =>
        expect(localThemeFile()?.unconfirmedContent).toBe(STYLE_SOURCE),
      );
      const lost = sentWrite(server, 3);
      const error = vi.spyOn(toast, "error").mockImplementation(() => "");

      // Redo is the other entry's run. It must not read, send, or move
      // anything while the first entry's write is unknown.
      fireEvent.click(screen.getByRole("button", { name: "Redo" }));
      await waitFor(() =>
        expect(
          error.mock.calls.some(([message]) =>
            String(message).startsWith("Could not redo:"),
          ),
        ).toBe(true),
      );
      expect({
        reads: server.read.mock.calls.length,
        writes: server.save.mock.calls.length,
        unconfirmed: localThemeFile()?.unconfirmedContent,
        local: localThemeFile()?.localContent,
        history: historyState(),
      }).toEqual({
        reads: 0,
        writes: 4,
        unconfirmed: STYLE_SOURCE,
        local: STYLE_SOURCE,
        history: { undoAvailable: true, redoAvailable: true },
      });

      fireEvent.click(screen.getByRole("button", { name: "Check and save" }));
      await waitFor(() => expect(server.read).toHaveBeenCalledTimes(1));
      await waitFor(() =>
        expect(localThemeFile()?.unconfirmedContent).toBeUndefined(),
      );
      const expectedWrites = lostOutcome === "offline" ? 5 : 4;
      await waitFor(() =>
        expect(historyState()).toEqual({
          undoAvailable: false,
          redoAvailable: true,
        }),
      );
      expect(server.save).toHaveBeenCalledTimes(expectedWrites);
      if (lostOutcome === "offline") {
        expect(basisOf(sentWrite(server, 4))).toEqual(basisOf(lost));
      }
      expect(server.file()).toMatchObject({
        content: STYLE_SOURCE,
        lastWriteAttemptId: lost.writeAttemptId,
      });

      // The next Redo is the first entry's: back to its own after.
      fireEvent.click(screen.getByRole("button", { name: "Redo" }));
      await waitFor(() =>
        expect(server.save).toHaveBeenCalledTimes(expectedWrites + 1),
      );
      await waitFor(() => expect(server.file().content).toBe(STYLE_AFTER));
    },
  );

  // Task 39 round 2.

  async function loseUndoThenAdvanceSource(
    server: ReturnType<typeof controlledThemeFile>,
  ) {
    renderShellWithHero(STYLE_SOURCE);
    await applyAndSaveStyle(server);
    server.outcomes.push("offline");
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    await waitFor(() =>
      expect(localThemeFile()?.unconfirmedContent).toBe(STYLE_SOURCE),
    );
    const lost = sentWrite(server, 1);
    // The author saved another Theme file meanwhile: the source moved on,
    // this file did not.
    server.externalSourceWrite();
    const error = vi.spyOn(toast, "error").mockImplementation(() => "");
    fireEvent.click(screen.getByRole("button", { name: "Check and save" }));
    await waitFor(() => expect(server.read).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(
        error.mock.calls.some(([message]) =>
          String(message).includes("can no longer be confirmed"),
        ),
      ).toBe(true),
    );
    expect({
      writes: server.save.mock.calls.length,
      history: historyState(),
      unconfirmed: localThemeFile()?.unconfirmedContent,
      sourceConflict: localThemeFile()?.sourceConflict,
      conflict: localThemeFile()?.conflict,
      local: localThemeFile()?.localContent,
      file: server.file(),
    }).toMatchObject({
      writes: 2,
      history: { undoAvailable: true, redoAvailable: false },
      unconfirmed: undefined,
      sourceConflict: true,
      conflict: undefined,
      local: STYLE_SOURCE,
      file: { content: STYLE_AFTER, version: 2, sourceGeneration: 3 },
    });
    expect(
      screen.queryByRole("button", { name: "Check and save" }),
    ).toBeNull();
    return { lost, error };
  }

  it("resolves a not-landed Style Undo whose source moved, and lets the author save it plainly at the newer basis", async () => {
    const server = controlledThemeFile(STYLE_SOURCE);
    const { lost } = await loseUndoThenAdvanceSource(server);

    fireEvent.click(screen.getByRole("button", { name: "Save my changes" }));
    await waitFor(() => expect(server.save).toHaveBeenCalledTimes(3));
    await waitFor(() =>
      expect(localThemeFile()?.sourceConflict).toBeUndefined(),
    );
    expect(basisOf(sentWrite(server, 2))).toEqual({
      content: STYLE_SOURCE,
      writeAttemptId: undefined,
      expectedFileId: "file-hero",
      expectedVersion: 2,
      expectedSourceGeneration: 3,
    });
    expect({
      history: historyState(),
      file: server.file(),
      saveState: localThemeFile()?.saveState,
    }).toMatchObject({
      // Nothing confirmed the Undo: its step is still open.
      history: { undoAvailable: true, redoAvailable: false },
      file: {
        content: STYLE_SOURCE,
        version: 3,
        sourceGeneration: 4,
        lastWriteAttemptId: null,
      },
      saveState: "clean",
    });

    // Undo and Redo of the file work again: a fresh run with its own receipt.
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    await waitFor(() => expect(server.save).toHaveBeenCalledTimes(4));
    await waitFor(() =>
      expect(historyState()).toEqual({
        undoAvailable: false,
        redoAvailable: true,
      }),
    );
    const rerun = sentWrite(server, 3);
    expect(rerun.writeAttemptId).toMatch(UUID);
    expect(rerun.writeAttemptId).not.toBe(lost.writeAttemptId);
    expect(rerun.expectedVersion).toBe(3);
    fireEvent.click(screen.getByRole("button", { name: "Redo" }));
    await waitFor(() => expect(server.save).toHaveBeenCalledTimes(5));
    await waitFor(() => expect(server.file().content).toBe(STYLE_AFTER));
    await waitFor(() =>
      expect(historyState()).toEqual({
        undoAvailable: true,
        redoAvailable: false,
      }),
    );
  });

  it("resolves a not-landed Style Undo whose source moved, and lets the author load the latest instead", async () => {
    const server = controlledThemeFile(STYLE_SOURCE);
    await loseUndoThenAdvanceSource(server);

    const dialog = await openLoadLatest();
    expect(listed(dialog, "Files to replace")).toEqual([
      stylePatchTarget.filePath,
    ]);
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Replace with the latest" }),
    );
    await waitFor(() =>
      expect(localThemeFile()?.sourceConflict).toBeUndefined(),
    );
    expect({
      writes: server.save.mock.calls.length,
      local: localThemeFile()?.localContent,
      server: localThemeFile()?.serverContent,
      dirty: localThemeFile()?.dirty,
      saveState: localThemeFile()?.saveState,
      // The file's entries describe text that was just replaced.
      history: historyState(),
    }).toEqual({
      writes: 2,
      local: STYLE_AFTER,
      server: STYLE_AFTER,
      dirty: false,
      saveState: "clean",
      history: { undoAvailable: false, redoAvailable: false },
    });

    // A new edit goes at the newer basis.
    applyStylePatch();
    await waitFor(() => expect(server.save).toHaveBeenCalledTimes(3));
    expect(basisOf(sentWrite(server, 2))).toMatchObject({
      writeAttemptId: undefined,
      expectedVersion: 2,
      expectedSourceGeneration: 3,
    });
    await waitFor(() => expect(localThemeFile()?.saveState).toBe("clean"));
  });

  async function openLoadLatest() {
    fireEvent.click(screen.getByRole("button", { name: "Load the latest…" }));
    return screen.findByRole("alertdialog");
  }
  const listed = (dialog: HTMLElement, name: string) =>
    within(within(dialog).getByRole("list", { name }))
      .getAllByRole("listitem")
      .map((item) => item.textContent);

  it("asks before Load the latest replaces anything; Keep my changes reads and changes nothing", async () => {
    const server = controlledThemeFile(STYLE_SOURCE);
    await loseUndoThenAdvanceSource(server);
    const listsBefore = server.list.mock.calls.length;
    const before = localThemeFile();

    const dialog = await openLoadLatest();
    expect(within(dialog).getByText(/cannot be undone/)).toBeTruthy();
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Keep my changes" }),
    );
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());

    expect({
      lists: server.list.mock.calls.length,
      reads: server.read.mock.calls.length,
      writes: server.save.mock.calls.length,
      file: localThemeFile(),
      history: historyState(),
    }).toEqual({
      lists: listsBefore,
      reads: 1,
      writes: 2,
      file: before,
      history: { undoAvailable: true, redoAvailable: false },
    });
  });

  it.each(["unconfirmed", "file conflict"] as const)(
    "Load the latest replaces only the listed files and keeps one whose state is %s, saying why",
    async (keptState) => {
      const server = controlledThemeFile(STYLE_SOURCE);
      await loseUndoThenAdvanceSource(server);
      const kept = "src/components/Kept.tsx";
      const keptText = "export const Kept = () => <p>mine</p>;";
      const workspace = () => useThemeWorkspaceStore.getState();
      act(() => {
        workspace().updateLocalContent(kept, keptText, scope);
        workspace().markSourceConflict(kept, scope);
        if (keptState === "unconfirmed") {
          workspace().markUnconfirmed(kept, keptText, scope);
        } else {
          workspace().markConflict(
            kept,
            {
              kind: "created",
              remoteExists: true,
              remoteFileId: "file-kept",
              remoteVersion: 1,
              remoteContent: "export const Kept = () => null;",
            },
            scope,
          );
          workspace().markSourceConflict(kept, scope);
        }
      });
      const keptBefore = workspace().getWorkspaceFiles(
        scope.storefrontId,
        scope.themeId,
      )[kept];
      const generationBefore = workspace().getAcceptedSourceGeneration(scope);
      const info = vi.spyOn(toast, "info").mockImplementation(() => "");

      const dialog = await openLoadLatest();
      expect(listed(dialog, "Files to replace")).toEqual([
        stylePatchTarget.filePath,
      ]);
      const keptLines = listed(dialog, "Files kept");
      expect(keptLines).toHaveLength(1);
      expect(keptLines[0]).toContain(kept);
      expect(keptLines[0]).toContain(
        keptState === "unconfirmed" ? "Check and save" : "conflict",
      );
      fireEvent.click(
        within(dialog).getByRole("button", { name: "Replace with the latest" }),
      );
      await waitFor(() =>
        expect(localThemeFile()?.sourceConflict).toBeUndefined(),
      );

      expect({
        heroLocal: localThemeFile()?.localContent,
        kept: workspace().getWorkspaceFiles(scope.storefrontId, scope.themeId)[
          kept
        ],
        // A source conflict remains (the kept file): the newer generation is
        // not accepted yet.
        generation: workspace().getAcceptedSourceGeneration(scope),
        writes: server.save.mock.calls.length,
      }).toEqual({
        heroLocal: STYLE_AFTER,
        kept: keptBefore,
        generation: generationBefore,
        writes: 2,
      });
      // Task 39 round 5 (R5-3): a file kept when the dialog opened is named
      // in the summary too.
      await waitFor(() => expect(info).toHaveBeenCalled());
      const summary = info.mock.calls.map(([m]) => String(m)).join(" | ");
      expect(summary).toContain(`Loaded the latest version of ${hero()}`);
      expect(summary).toContain(`Kept: ${kept}`);
    },
  );

  // Task 39 round 4.

  const hero = () => stylePatchTarget.filePath;
  const workspaceFileAt = (path: string) =>
    useThemeWorkspaceStore
      .getState()
      .getWorkspaceFiles(scope.storefrontId, scope.themeId)[path];
  const infoSaying = (info: { mock: { calls: ReadonlyArray<ReadonlyArray<unknown>> } }) =>
    info.mock.calls.map(([message]) => String(message)).join("\n");

  it("keeps a file whose save is in flight when Replace is confirmed, and lets that save land", async () => {
    const server = controlledThemeFile(STYLE_SOURCE);
    await loseUndoThenAdvanceSource(server);
    const saveFile = await captureCodeFileSave();
    const info = vi.spyOn(toast, "info").mockImplementation(() => "");

    const dialog = await openLoadLatest();
    expect(listed(dialog, "Files to replace")).toEqual([hero()]);
    const release = server.holdNextSave();
    let saving: Promise<unknown> = Promise.resolve();
    act(() => {
      saving = saveFile(hero(), CODE_EDIT, { confirmed: true }).catch(
        () => {},
      );
    });
    await waitFor(() => expect(server.save).toHaveBeenCalledTimes(3));
    expect(screen.getByRole("alertdialog")).toBe(dialog);
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Replace with the latest" }),
    );
    // Give Load the latest time to run ahead of the held save if it does not
    // wait for it (the race this guards against), then let the save answer.
    await act(async () => {
      await new Promise<void>((resolve) => setTimeout(resolve, 100));
    });
    release();
    await act(async () => {
      await saving;
    });
    // The data first: the author's save landed and the tab holds it.
    await waitFor(() =>
      expect({
        local: workspaceFileAt(hero())?.localContent,
        server: workspaceFileAt(hero())?.serverContent,
        saveState: workspaceFileAt(hero())?.saveState,
        file: server.file(),
      }).toMatchObject({
        local: CODE_EDIT,
        server: CODE_EDIT,
        saveState: "clean",
        file: { content: CODE_EDIT, version: 3 },
      }),
    );
    await waitFor(() => expect(infoSaying(info)).toContain("Kept"));
    expect(infoSaying(info)).toContain(hero());
    expect(infoSaying(info)).toContain("on its way");
  });

  it("keeps a file whose save is queued when Replace is confirmed; the queued save goes as the author's", async () => {
    const server = controlledThemeFile(STYLE_SOURCE);
    await loseUndoThenAdvanceSource(server);
    const other = "src/components/Queued.tsx";
    server.addOtherFile(other, "export const Q = 1;");
    act(() =>
      useThemeWorkspaceStore
        .getState()
        .markSaved({ ...server.otherFile(other)! }, scope),
    );
    const saveFile = await captureCodeFileSave();
    const info = vi.spyOn(toast, "info").mockImplementation(() => "");

    const dialog = await openLoadLatest();
    const release = server.holdNextSave();
    let first: Promise<unknown> = Promise.resolve();
    let queued: Promise<unknown> = Promise.resolve();
    act(() => {
      first = saveFile(other, "export const Q = 2;", { confirmed: true }).catch(
        () => {},
      );
    });
    await waitFor(() => expect(server.save).toHaveBeenCalledTimes(3));
    act(() => {
      queued = saveFile(hero(), CODE_EDIT, { confirmed: true }).catch(
        () => {},
      );
    });
    expect(screen.getByRole("alertdialog")).toBe(dialog);
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Replace with the latest" }),
    );
    // Give Load the latest time to run ahead of the held save if it does not
    // wait for it (the race this guards against), then let the save answer.
    await act(async () => {
      await new Promise<void>((resolve) => setTimeout(resolve, 100));
    });
    release();
    await act(async () => {
      await first;
      await queued;
    });
    await waitFor(() =>
      expect({
        writes: server.save.mock.calls.length,
        local: workspaceFileAt(hero())?.localContent,
        saveState: workspaceFileAt(hero())?.saveState,
        file: server.file(),
      }).toMatchObject({
        writes: 4,
        local: CODE_EDIT,
        saveState: "clean",
        file: { content: CODE_EDIT, version: 3 },
      }),
    );
    await waitFor(() => expect(infoSaying(info)).toContain("Kept"));
    expect(infoSaying(info)).toContain(hero());
    expect(infoSaying(info)).toContain("on its way");
  });

  it("keeps a file whose save starts after Replace is confirmed but before the load runs", async () => {
    const server = controlledThemeFile(STYLE_SOURCE);
    await loseUndoThenAdvanceSource(server);
    const other = "src/components/Queued.tsx";
    server.addOtherFile(other, "export const Q = 1;");
    act(() =>
      useThemeWorkspaceStore
        .getState()
        .markSaved({ ...server.otherFile(other)! }, scope),
    );
    const saveFile = await captureCodeFileSave();
    const info = vi.spyOn(toast, "info").mockImplementation(() => "");

    const dialog = await openLoadLatest();
    const release = server.holdNextSave();
    let first: Promise<unknown> = Promise.resolve();
    let later: Promise<unknown> = Promise.resolve();
    act(() => {
      first = saveFile(other, "export const Q = 2;", { confirmed: true }).catch(
        () => {},
      );
    });
    await waitFor(() => expect(server.save).toHaveBeenCalledTimes(3));
    // Hero has no save on its way yet: it is confirmed for replacing.
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Replace with the latest" }),
    );
    await act(async () => {
      await new Promise<void>((resolve) => setTimeout(resolve, 100));
    });
    // Now the author saves Hero, before the load (held behind the first
    // save, if it waits for it) has run.
    act(() => {
      later = saveFile(hero(), CODE_EDIT, { confirmed: true }).catch(() => {});
    });
    release();
    await act(async () => {
      await first;
      await later;
    });
    await waitFor(() =>
      expect({
        local: workspaceFileAt(hero())?.localContent,
        saveState: workspaceFileAt(hero())?.saveState,
        file: server.file(),
      }).toMatchObject({
        local: CODE_EDIT,
        saveState: "clean",
        file: { content: CODE_EDIT },
      }),
    );
    await waitFor(() => expect(infoSaying(info)).toContain("Kept"));
    expect(infoSaying(info)).toContain("on its way");
  });

  // Task 39 round 5 (R5-1): an edit waiting on its debounce is a save on its
  // way too. Replacing the file under it would let the debounced save send
  // its older text over the loaded one at the newest basis.
  it("keeps a file with a debounced Style edit made after Replace is confirmed but before the load runs", async () => {
    const server = controlledThemeFile(STYLE_SOURCE);
    await loseUndoThenAdvanceSource(server);
    const other = "src/components/Queued.tsx";
    server.addOtherFile(other, "export const Q = 1;");
    act(() =>
      useThemeWorkspaceStore
        .getState()
        .markSaved({ ...server.otherFile(other)! }, scope),
    );
    const saveFile = await captureCodeFileSave();
    // Back to Design, where the Style edit is made; the captured save stays.
    act(() => {
      screen.getByRole("button", { name: /^Design$/ }).click();
    });
    await screen.findByRole("button", { name: "Apply a style patch" });
    const info = vi.spyOn(toast, "info").mockImplementation(() => "");

    const dialog = await openLoadLatest();
    const release = server.holdNextSave();
    let first: Promise<unknown> = Promise.resolve();
    act(() => {
      first = saveFile(other, "export const Q = 2;", { confirmed: true }).catch(
        () => {},
      );
    });
    await waitFor(() => expect(server.save).toHaveBeenCalledTimes(3));
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Replace with the latest" }),
    );
    // A Style edit of Hero while the load waits behind the held save: it is
    // debounced, not yet in the save queue. (Two patches, so the tab's text
    // differs from the copy it last read.)
    applyStylePatch();
    applyStylePatch();
    await waitFor(() =>
      expect(workspaceFileAt(hero())?.saveState).toBe("debouncing"),
    );
    const edited = workspaceFileAt(hero())?.localContent;
    expect(edited).toContain("p-8 p-8");
    release();
    await act(async () => {
      await first;
    });
    await waitFor(() => expect(infoSaying(info)).toContain("Kept"));
    expect(infoSaying(info)).toContain(hero());
    expect(infoSaying(info)).toContain("on its way");
    // The debounced edit then goes as the author's, over the file it was
    // made on: nothing replaced the file under it, so the tab holds exactly
    // what was stored (replaced first, the tab would show the Theme's older
    // copy as unsaved over the author's stored edit).
    await waitFor(() => expect(server.save).toHaveBeenCalledTimes(4));
    await waitFor(() =>
      expect({
        server: server.file().content,
        local: workspaceFileAt(hero())?.localContent,
        saveState: workspaceFileAt(hero())?.saveState,
      }).toEqual({ server: edited, local: edited, saveState: "clean" }),
    );
  });

  it("re-checks at confirm: a file that became unconfirmed after the dialog opened is kept and named", async () => {
    const server = controlledThemeFile(STYLE_SOURCE);
    await loseUndoThenAdvanceSource(server);
    const info = vi.spyOn(toast, "info").mockImplementation(() => "");

    const dialog = await openLoadLatest();
    expect(listed(dialog, "Files to replace")).toEqual([hero()]);
    act(() =>
      useThemeWorkspaceStore
        .getState()
        .markUnconfirmed(hero(), STYLE_SOURCE, scope),
    );
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Replace with the latest" }),
    );
    await waitFor(() => expect(infoSaying(info)).toContain("Kept"));

    expect(infoSaying(info)).toContain(hero());
    expect(infoSaying(info)).toContain("Check and save");
    expect({
      local: workspaceFileAt(hero())?.localContent,
      unconfirmed: workspaceFileAt(hero())?.unconfirmedContent,
      sourceConflict: workspaceFileAt(hero())?.sourceConflict,
    }).toEqual({
      local: STYLE_SOURCE,
      unconfirmed: STYLE_SOURCE,
      sourceConflict: true,
    });
  });

  it("loads an editable public text file's current text instead of dropping it", async () => {
    const server = controlledThemeFile(STYLE_SOURCE);
    await loseUndoThenAdvanceSource(server);
    const notes = "public/notes.txt";
    server.addPublicText(notes, "server notes\n");
    act(() => {
      const workspace = useThemeWorkspaceStore.getState();
      workspace.markSaved(
        {
          id: `file-${notes}`,
          storefrontId: "storefront-1",
          themeId: "theme-1",
          path: notes,
          content: "older notes\n",
          mimeType: "text/plain",
          isEntry: false,
          version: 1,
          createdAt: "2026-08-20T00:00:00.000Z",
          updatedAt: "2026-08-20T00:00:00.000Z",
        },
        scope,
      );
      workspace.updateLocalContent(notes, "my notes\n", scope);
      workspace.markSourceConflict(notes, scope);
    });

    const dialog = await openLoadLatest();
    expect(listed(dialog, "Files to replace")).toEqual([notes, hero()].sort());
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Replace with the latest" }),
    );
    await waitFor(() =>
      expect(workspaceFileAt(notes)?.sourceConflict).toBeUndefined(),
    );
    expect({
      local: workspaceFileAt(notes)?.localContent,
      server: workspaceFileAt(notes)?.serverContent,
      version: workspaceFileAt(notes)?.serverVersion,
      dirty: workspaceFileAt(notes)?.dirty,
    }).toEqual({
      local: "server notes\n",
      server: "server notes\n",
      version: 2,
      dirty: false,
    });
  });

  // Task 39 round 5 (R5-2), replacing round 4's "removed" expectation for a
  // file never saved to the Theme: it was never on the server, so it is not
  // "deleted on the server", and Load the latest leaves it alone.
  it("keeps a local file never saved to the Theme out of Load the latest, saying so", async () => {
    const server = controlledThemeFile(STYLE_SOURCE);
    await loseUndoThenAdvanceSource(server);
    const draft = "src/components/Draft.tsx";
    act(() => {
      const workspace = useThemeWorkspaceStore.getState();
      workspace.updateLocalContent(draft, "export const Draft = 1;", scope);
      workspace.markSourceConflict(draft, scope);
    });
    const draftBefore = workspaceFileAt(draft);
    const info = vi.spyOn(toast, "info").mockImplementation(() => "");

    const dialog = await openLoadLatest();
    expect(listed(dialog, "Files to replace")).toEqual([hero()]);
    expect(within(dialog).queryByRole("list", { name: "Files to remove" })).toBeNull();
    const keptLines = listed(dialog, "Files kept");
    expect(keptLines).toHaveLength(1);
    expect(keptLines[0]).toContain(draft);
    expect(keptLines[0]).toContain("never saved to the Theme");
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Replace with the latest" }),
    );
    await waitFor(() => expect(infoSaying(info)).toContain("Kept"));
    expect(infoSaying(info)).toContain(draft);
    expect(infoSaying(info)).not.toContain("Removed");
    expect(workspaceFileAt(draft)).toEqual(draftBefore);
    expect(workspaceFileAt(hero())?.localContent).toBe(STYLE_AFTER);
  });

  it("names a file found deleted on the server at run time as removed, not replaced", async () => {
    const server = controlledThemeFile(STYLE_SOURCE);
    await loseUndoThenAdvanceSource(server);
    const info = vi.spyOn(toast, "info").mockImplementation(() => "");

    const dialog = await openLoadLatest();
    expect(listed(dialog, "Files to replace")).toEqual([hero()]);
    server.deleteOnServer();
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Replace with the latest" }),
    );
    await waitFor(() => expect(infoSaying(info)).toContain("Removed"));
    expect(infoSaying(info)).toContain(hero());
    expect(infoSaying(info)).toContain("deleted on the server");
    expect(workspaceFileAt(hero())).toBeUndefined();
  });

  it("does not confirm a Check and save resend whose answer names another receipt", async () => {
    const server = controlledThemeFile(STYLE_SOURCE);
    renderShellWithHero(STYLE_SOURCE);
    await applyAndSaveStyle(server);
    server.outcomes.push("offline");
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    await waitFor(() =>
      expect(localThemeFile()?.unconfirmedContent).toBe(STYLE_SOURCE),
    );
    const lost = sentWrite(server, 1);

    server.outcomes.push("saved-foreign-receipt");
    fireEvent.click(screen.getByRole("button", { name: "Check and save" }));
    await waitFor(() => expect(server.save).toHaveBeenCalledTimes(3));
    await waitFor(() =>
      expect(localThemeFile()?.unconfirmedContent).toBeUndefined(),
    );
    await waitFor(() => expect(historyState().undoAvailable).toBe(true));
    expect(sentWrite(server, 2).writeAttemptId).toBe(lost.writeAttemptId);
    expect({
      history: historyState(),
      conflict: localThemeFile()?.conflict,
    }).toEqual({
      history: { undoAvailable: true, redoAvailable: false },
      conflict: undefined,
    });

    // The stored replay is not reused by the next run.
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    await waitFor(() => expect(server.save).toHaveBeenCalledTimes(4));
    const rerun = sentWrite(server, 3);
    expect(rerun.writeAttemptId).toMatch(UUID);
    expect(rerun.writeAttemptId).not.toBe(lost.writeAttemptId);
  });

  it("refuses an Edit entry's history run of the file before touching it while a Style replay is stored", async () => {
    const server = controlledThemeFile(STYLE_SOURCE);
    renderShellWithHero(STYLE_SOURCE);
    await applyAndSaveStyle(server);
    const saveFile = await captureCodeFileSave();
    const codeText = STYLE_AFTER + "\n// typed in Code";
    await act(async () => {
      await saveFile(stylePatchTarget.filePath, codeText, { confirmed: true });
    });
    expect(server.save).toHaveBeenCalledTimes(2);

    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    await waitFor(() => expect(server.save).toHaveBeenCalledTimes(3));
    await waitFor(() => expect(server.file().content).toBe(STYLE_AFTER));
    await waitFor(() => expect(historyState().redoAvailable).toBe(true));

    server.outcomes.push("offline");
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    await waitFor(() =>
      expect(localThemeFile()?.unconfirmedContent).toBe(STYLE_SOURCE),
    );
    const error = vi.spyOn(toast, "error").mockImplementation(() => "");

    // Redo is the Code edit's entry: a generic file history run.
    fireEvent.click(screen.getByRole("button", { name: "Redo" }));
    await waitFor(() =>
      expect(
        error.mock.calls.some(
          ([message]) =>
            String(message).startsWith("Could not redo:") &&
            String(message).includes("Use Check and save first"),
        ),
      ).toBe(true),
    );
    expect({
      reads: server.read.mock.calls.length,
      writes: server.save.mock.calls.length,
      local: localThemeFile()?.localContent,
      unconfirmed: localThemeFile()?.unconfirmedContent,
      history: historyState(),
    }).toEqual({
      reads: 0,
      writes: 4,
      local: STYLE_SOURCE,
      unconfirmed: STYLE_SOURCE,
      history: { undoAvailable: true, redoAvailable: true },
    });
  });

  it.each(["code save", "check and save"] as const)(
    "does not settle a Style replay by receipt when the file holds other text (%s)",
    async (via) => {
      const server = controlledThemeFile(STYLE_SOURCE);
      renderShellWithHero(STYLE_SOURCE);
      await applyAndSaveStyle(server);
      server.outcomes.push("offline-after-landing");
      fireEvent.click(screen.getByRole("button", { name: "Undo" }));
      await waitFor(() =>
        expect(localThemeFile()?.unconfirmedContent).toBe(STYLE_SOURCE),
      );
      // Same receipt, version and generation; other bytes.
      server.replaceContentKeepingReceipt(STYLE_REMOTE);
      vi.spyOn(toast, "error").mockImplementation(() => "");

      if (via === "code save") {
        const saveFile = await captureCodeFileSave();
        await act(async () => {
          await saveFile(stylePatchTarget.filePath, CODE_EDIT, {
            confirmed: true,
          }).catch(() => {});
        });
      } else {
        fireEvent.click(
          screen.getByRole("button", { name: "Check and save" }),
        );
        await waitFor(() => expect(server.read).toHaveBeenCalledTimes(1));
        await waitFor(() =>
          expect(localThemeFile()?.conflict).toBeDefined(),
        );
      }

      expect({
        reads: server.read.mock.calls.length,
        writes: server.save.mock.calls.length,
        history: historyState(),
        remote: localThemeFile()?.conflict?.remoteContent,
      }).toEqual({
        reads: 1,
        writes: 2,
        history: { undoAvailable: true, redoAvailable: false },
        remote: STYLE_REMOTE,
      });
    },
  );
});

describe("Edit replay as the file-history control", () => {
  const scope = { storefrontId: "storefront-1", themeId: "theme-1" };
  const editedSource = STYLE_SOURCE + "\n// saved through Code mode";

  beforeEach(() => {
    useThemeWorkspaceStore.setState({ workspaces: {} });
    stylePatchTarget.filePath = "src/components/Hero.tsx";
    stylePatchTarget.elementName = "section";
  });

  const historyState = () => ({
    undoAvailable: !screen
      .getByRole("button", { name: "Undo" })
      .hasAttribute("disabled"),
    redoAvailable: !screen
      .getByRole("button", { name: "Redo" })
      .hasAttribute("disabled"),
  });

  const editReplayAttempts = [
    { direction: "undo", outcome: "source-conflict" },
    { direction: "undo", outcome: "auth-paused" },
    { direction: "undo", outcome: "superseded" },
    { direction: "undo", outcome: "server-refusal" },
    { direction: "redo", outcome: "source-conflict" },
    { direction: "redo", outcome: "auth-paused" },
    { direction: "redo", outcome: "superseded" },
    { direction: "redo", outcome: "server-refusal" },
  ] as const;

  it.each(editReplayAttempts)(
    "keeps Edit $direction history and reports $outcome",
    async ({ direction, outcome }) => {
      const server = controlledThemeFile(STYLE_SOURCE);
      await createEditHistoryEntry(editedSource);
      expect(server.save).toHaveBeenCalledTimes(1);
      if (direction === "redo") {
        fireEvent.click(screen.getByRole("button", { name: "Undo" }));
        await waitFor(() => expect(server.save).toHaveBeenCalledTimes(2));
        await waitFor(() => expect(historyState().redoAvailable).toBe(true));
        expect(server.file().content).toBe(STYLE_SOURCE);
      }
      const writesBeforeReplay = server.save.mock.calls.length;
      const supersededBeforeReplay = themeFileQueueControl.supersededCount;
      const error = vi.spyOn(toast, "error").mockImplementation(() => "");
      if (outcome === "source-conflict" || outcome === "server-refusal") {
        server.outcomes.push(outcome);
      } else if (outcome === "auth-paused") {
        useEditorWriteGateStore
          .getState()
          .pause(scope, "ACCESS_DENIED", "theme");
      } else {
        themeFileQueueControl.supersedeNext = true;
      }

      fireEvent.click(
        screen.getByRole("button", {
          name: direction === "undo" ? "Undo" : "Redo",
        }),
      );

      if (outcome === "source-conflict" || outcome === "server-refusal") {
        await waitFor(() =>
          expect(server.save).toHaveBeenCalledTimes(writesBeforeReplay + 1),
        );
      } else if (outcome === "auth-paused") {
        await waitFor(() => expect(localThemeFile()?.authPaused).toBe(true));
      } else {
        await waitFor(() =>
          expect(themeFileQueueControl.supersededCount).toBe(
            supersededBeforeReplay + 1,
          ),
        );
      }
      await waitFor(() => expect(error).toHaveBeenCalled());

      expect(historyState()).toEqual({
        undoAvailable: direction === "undo",
        redoAvailable: direction === "redo",
      });
      expect(
        error.mock.calls.some(([message]) =>
          String(message).startsWith(
            direction === "undo" ? "Could not undo:" : "Could not redo:",
          ),
        ),
      ).toBe(true);
    },
  );
});

/**
 * Typing over text on the canvas is an edit of the field only when the text
 * was the stored value. A Theme's `content()` may change a value on its way to
 * the page; saving the typed text would store it changed, again on each pass.
 */
describe("an inline edit of text the Theme changed", () => {
  // Answered as the server answers: the document it now holds, one
  // generation past the one the write was sent at.
  const saved = () =>
    updateSectionProps.mockImplementation(async ({ data }) => ({
      success: true,
      data: {
        draftGeneration: data.expectedDraftGeneration + 1,
        droppedProps: [],
        document: {
          version: 1,
          sections: [
            {
              id: "hero",
              type: "hero",
              props: { heading: "Welcome", ...data.props },
            },
          ],
        },
      },
    }));

  it("is not saved, and the canvas is left to what the Theme rendered", async () => {
    saved();
    const info = vi.spyOn(toast, "info").mockImplementation(() => "");
    renderShell();
    await selectHeading();
    posted.length = 0;

    sendInlineCommit("TRANSFORMED:WELCOME!", "TRANSFORMED:WELCOME");

    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(updateSectionProps).not.toHaveBeenCalled();
    // The preview already put back what the Theme rendered. Pushing the
    // stored value onto the canvas here would show it without content().
    expect(
      messagesOfType("morph:storefront-preview-update-section-props"),
    ).toEqual([]);
    expect(info).toHaveBeenCalledWith(
      INLINE_TEXT_NOT_SAVED_MESSAGE,
      expect.anything(),
    );
    const retained = screen.getByRole("textbox", {
      name: "Copy text that was not saved",
    }) as HTMLTextAreaElement;
    expect(retained.value).toBe("TRANSFORMED:WELCOME!");
    expect(screen.getByText("Not saved — reselect then type.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /discard/i })).toBeNull();

    // Reselecting only restores the normal editor selection; it never submits
    // the preserved text. The author must type it again explicitly.
    await selectHeading();
    await new Promise((resolve) => setTimeout(resolve, 350));
    expect(updateSectionProps).not.toHaveBeenCalled();
    expect(retained.value).toBe("TRANSFORMED:WELCOME!");
  });

  it("is saved when the text was the stored value", async () => {
    saved();
    renderShell();

    await commitInlineText("Welcome home", "Welcome");

    await waitFor(() => expect(updateSectionProps).toHaveBeenCalledTimes(1));
    const sent = updateSectionProps.mock.calls[0]![0] as {
      data: { props: Record<string, unknown> };
    };
    expect(sent.data.props).toEqual({ heading: "Welcome home" });
  });

  it("is not saved when another tab changed the field while it was typed", async () => {
    saved();
    vi.spyOn(toast, "info").mockImplementation(() => "");
    const client = readyQueryClient();
    const view = renderShell(client);
    await selectHeading();

    // Another tab's save reaches this editor while the canvas edit is open.
    view.rerender(
      <QueryClientProvider client={client}>
        <VisualEditorShell
          context={
            editorHolding({ heading: "Theirs" })
              .data as unknown as StorefrontThemeEditorDTO
          }
          search={baseSearch}
          onSearchChange={vi.fn()}
        />
      </QueryClientProvider>,
    );
    // The edit began from the value this tab saw.
    sendInlineCommit("Welcome, mine", "Welcome");

    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(updateSectionProps).not.toHaveBeenCalled();

    // The control: an edit begun from the value now stored is saved, so the
    // refusal above was about the moved value and nothing else.
    sendInlineCommit("Theirs, edited", "Theirs");
    await waitFor(() => expect(updateSectionProps).toHaveBeenCalledTimes(1));
    const sent = updateSectionProps.mock.calls[0]![0] as {
      data: { props: Record<string, unknown> };
    };
    expect(sent.data.props).toEqual({ heading: "Theirs, edited" });
  });

  it("is not saved when another tab's save, at a newer generation, changed the field", async () => {
    saved();
    const info = vi.spyOn(toast, "info").mockImplementation(() => "");
    const warning = vi.spyOn(toast, "warning").mockImplementation(() => "");
    const client = readyQueryClient();
    const view = renderShell(client);
    await selectHeading();
    fireEvent.click(screen.getByRole("button", { name: /^Content$/ }));
    await screen.findByDisplayValue("Welcome");

    // Another tab's save, read back at the generation it produced.
    view.rerender(
      <QueryClientProvider client={client}>
        <VisualEditorShell
          context={
            editorHolding({ heading: "Theirs" }, 2)
              .data as unknown as StorefrontThemeEditorDTO
          }
          search={baseSearch}
          onSearchChange={vi.fn()}
        />
      </QueryClientProvider>,
    );
    sendInlineCommit("Welcome, mine", "Welcome");

    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(updateSectionProps).not.toHaveBeenCalled();
    expect(info).toHaveBeenCalledWith(
      INLINE_TEXT_NOT_SAVED_MESSAGE,
      expect.anything(),
    );

    // The editor has now re-presented the page at the new Document generation.
    // The control edit is accepted only after that presentation is acknowledged.
    await waitFor(() =>
      expect(
        messagesOfType("morph:storefront-preview-update-section-props").some(
          (message) => {
            const token = message.presentationToken as
              { documentBasis?: { draftGeneration?: number } } | undefined;
            return token?.documentBasis?.draftGeneration === 2;
          },
        ),
      ).toBe(true),
    );
    await flushFrames();
    sendInlineCommit("Theirs, edited", "Theirs");
    await waitFor(() => expect(updateSectionProps).toHaveBeenCalledTimes(1));
    const sent = updateSectionProps.mock.calls[0]![0] as {
      data: { props: Record<string, unknown>; expectedDraftGeneration: number };
    };
    expect(sent.data.props).toEqual({ heading: "Theirs, edited" });
    expect(sent.data.expectedDraftGeneration).toBe(2);
    expect(warning).not.toHaveBeenCalled();
  });

  it("is not saved when it names a field other than the one selected", async () => {
    saved();
    renderShell();
    await selectHeading();

    // A late commit from an edit of another field.
    sendInlineCommit("Late", "Welcome", {
      fieldKey: "subheading",
      fieldPath: "subheading",
    });

    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(updateSectionProps).not.toHaveBeenCalled();
  });

  it("holds an obsolete selected field rather than borrowing the newer workspace generation", async () => {
    useThemeWorkspaceStore.getState().setBaseSourceGeneration(1, {
      storefrontId: "storefront-1",
      themeId: "theme-1",
    });
    const message =
      "The source code has changed. Select the field again. Your changes are kept.";
    updateSectionProps.mockResolvedValue({
      success: false,
      error: "SELECTION_SOURCE_CONFLICT",
      message,
    } as never);
    const error = vi.spyOn(toast, "error").mockImplementation(() => "");
    renderShell();
    await selectHeading();
    act(() =>
      useThemeWorkspaceStore.getState().acceptRemoteGeneration(2, {
        storefrontId: "storefront-1",
        themeId: "theme-1",
      }),
    );
    sendInlineCommit("Unsaved from old source", "Welcome");
    // Once the newer source is known, rejection is client-side, not an RPC.
    await waitFor(() =>
      expect(error).toHaveBeenCalledWith(message, {
        id: "selection-source-conflict",
      }),
    );
    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(updateSectionProps).not.toHaveBeenCalled();
    expect(saveStatus()).not.toBe("Saved");
  });

  it("keeps the same selected source precondition for two content-only saves", async () => {
    useThemeWorkspaceStore.getState().setBaseSourceGeneration(1, {
      storefrontId: "storefront-1",
      themeId: "theme-1",
    });
    saved();
    renderShell();
    await selectHeading();
    sendInlineCommit("First own save", "Welcome");
    await waitFor(() => expect(updateSectionProps).toHaveBeenCalledTimes(1));
    // The second edit begins from the text the first save left on the page.
    sendInlineCommit("Second own save", "First own save");
    await waitFor(() => expect(updateSectionProps).toHaveBeenCalledTimes(2));
    expect(
      updateSectionProps.mock.calls.map(
        (call) => call[0].data.expectedSourceGeneration,
      ),
    ).toEqual([1, 1]);
  });

  it("refuses a second edit that claims the text from before the first own save", async () => {
    const scope = { storefrontId: "storefront-1", themeId: "theme-1" };
    useThemeWorkspaceStore.getState().setBaseSourceGeneration(1, scope);
    saved();
    const info = vi.spyOn(toast, "info").mockImplementation(() => "");
    renderShell();
    await selectHeading();
    sendInlineCommit("First own save", "Welcome");
    await waitFor(() => expect(updateSectionProps).toHaveBeenCalledTimes(1));
    const sourceBaseline = () => {
      const state = useThemeWorkspaceStore.getState();
      return {
        accepted: state.getAcceptedSourceGeneration(scope),
        observed: state.getObservedSourceGeneration(scope),
      };
    };
    const before = sourceBaseline();

    // The first save's answer is the stored value now; the editor context
    // has not caught up. A claim of the older text is out of date.
    sendInlineCommit("Second own save", "Welcome");

    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(updateSectionProps).toHaveBeenCalledTimes(1);
    expect(info).toHaveBeenCalledWith(
      INLINE_TEXT_NOT_SAVED_MESSAGE,
      expect.anything(),
    );
    expect(sourceBaseline()).toEqual(before);
  });

  it("keeps Inspector text visible after a source baseline refusal without resending", async () => {
    useThemeWorkspaceStore.getState().setBaseSourceGeneration(1, {
      storefrontId: "storefront-1",
      themeId: "theme-1",
    });
    const message =
      "The source code has changed. Select the field again. Your changes are kept.";
    updateSectionProps.mockResolvedValue({
      success: false,
      error: "SELECTION_SOURCE_CONFLICT",
      message,
    } as never);
    renderShellWithHero(
      'export const contentFields = { heading: { type: "text", label: "Heading" } }; export function Hero({ heading = "Welcome" }) { return <h1>{heading}</h1>; }',
      "hero",
    );
    await selectHeading();
    fireEvent.click(screen.getByRole("button", { name: /^Content$/ }));
    const input = await screen.findByDisplayValue("Welcome");
    act(() =>
      useThemeWorkspaceStore.getState().acceptRemoteGeneration(2, {
        storefrontId: "storefront-1",
        themeId: "theme-1",
      }),
    );
    fireEvent.input(input, { target: { value: "Unsaved Inspector text" } });
    fireEvent.blur(input);
    await waitFor(() => expect(saveStatus()).toBe("Save failed"));
    const expectDraftInActivePanel = () => {
      const field = screen.getByDisplayValue("Unsaved Inspector text");
      expect(field.isConnected).toBe(true);
      expect(field.closest("[hidden], [inert]")).toBeNull();
      for (
        let element: Element | null = field;
        element;
        element = element.parentElement
      ) {
        expect(window.getComputedStyle(element).display).not.toBe("none");
      }
    };
    expectDraftInActivePanel();
    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(updateSectionProps).not.toHaveBeenCalled();
    expectDraftInActivePanel();
  });

  it("is not saved when it comes from a window other than the preview", async () => {
    saved();
    renderShell();
    await selectHeading();

    act(() => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: {
            type: "morph:storefront-preview-commit-inline-text",
            sectionId: "hero",
            fieldKey: "heading",
            fieldPath: "heading",
            value: "Forged",
            originalValue: "Welcome",
            previewSession: PREVIEW_SESSION,
          },
          origin: PREVIEW_ORIGIN,
          source: window,
        }),
      );
    });

    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(updateSectionProps).not.toHaveBeenCalled();
  });

  it("tells the author where to edit text the preview would not open", async () => {
    const info = vi.spyOn(toast, "info").mockImplementation(() => "");
    renderShell();
    await selectHeading();

    fromPreview({
      type: "morph:storefront-preview-inline-text-refused",
      sectionId: "hero",
      fieldPath: "heading",
    });

    expect(info).toHaveBeenCalledWith(
      INLINE_TEXT_REFUSED_MESSAGE,
      expect.anything(),
    );
  });
});
