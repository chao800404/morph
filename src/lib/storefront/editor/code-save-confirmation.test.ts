import { describe, expect, it } from "vitest";
import {
  createSentCodeWrites,
  draftAfterConfirmedWrite,
  draftAfterLostWriteSettled,
  syncBufferToServer,
} from "./code-save-confirmation";

const PATH = "src/components/Hero.tsx";

describe("draftAfterConfirmedWrite", () => {
  it("is clean when the buffer still shows what was sent", () => {
    expect(
      draftAfterConfirmedWrite({ sent: "a\n", saved: "a\n", draft: "a\n" }),
    ).toBe("clean");
  });

  it("is dirty when the author undid what was sent", () => {
    expect(
      draftAfterConfirmedWrite({ sent: "a\n", saved: "a\n", draft: "a" }),
    ).toBe("dirty");
  });

  it("is dirty when the author typed past what was sent", () => {
    expect(
      draftAfterConfirmedWrite({ sent: "a\n", saved: "a\n", draft: "a\nb" }),
    ).toBe("dirty");
  });

  it("leaves a file the workspace holds no buffer for alone", () => {
    expect(
      draftAfterConfirmedWrite({ sent: "a", saved: "a", draft: undefined }),
    ).toBe("untouched");
  });
});

describe("syncBufferToServer", () => {
  const base = {
    serverContent: "server",
    buffer: "buffer",
    draftDirty: false,
    ownWriteAwaitingAnswer: false,
  };

  it("replaces an untouched buffer when the change came from elsewhere", () => {
    expect(syncBufferToServer(base)).toBe("replace");
  });

  it("keeps an unsaved draft", () => {
    expect(syncBufferToServer({ ...base, draftDirty: true })).toBe(
      "keep-draft",
    );
  });

  it("keeps the author's later edits when the change is the answer to their own write", () => {
    expect(
      syncBufferToServer({ ...base, ownWriteAwaitingAnswer: true }),
    ).toBe("keep-later-edits");
  });

  it("does nothing when the buffer already shows the server's text", () => {
    expect(
      syncBufferToServer({ ...base, buffer: "server", draftDirty: true }),
    ).toBe("in-sync");
  });
});

describe("two writes in flight", () => {
  /**
   * The Code workspace sends one save at a time, so this cannot be produced
   * by mounting it; the rules are stated here for either order of answers.
   * `answer` runs the sync check the way the editor does when the shell
   * records the answer first, then settles the write.
   */
  function scenario(buffer: () => string) {
    const writes = createSentCodeWrites();
    const first = { path: PATH, content: "A" };
    const second = { path: PATH, content: "AB" };
    writes.sent(first);
    writes.sent(second);
    const answer = (write: typeof first) => {
      const sync = syncBufferToServer({
        serverContent: write.content,
        buffer: buffer(),
        draftDirty: false,
        ownWriteAwaitingAnswer: writes.awaitsAnswer(PATH, write.content),
      });
      const draft = draftAfterConfirmedWrite({
        sent: write.content,
        saved: write.content,
        draft: buffer(),
      });
      writes.answered(write);
      return { sync, draft };
    };
    return { writes, first, second, answer };
  }

  it("answered in order, keeps an undo made while the second was out", () => {
    let buffer = "AB";
    const t = scenario(() => buffer);
    expect(t.answer(t.first)).toEqual({
      sync: "keep-later-edits",
      draft: "dirty",
    });
    buffer = "A"; // Ctrl+Z
    expect(t.answer(t.second)).toEqual({
      sync: "keep-later-edits",
      draft: "dirty",
    });
    expect(t.writes.awaitsAnswer(PATH, "A")).toBe(false);
    expect(t.writes.awaitsAnswer(PATH, "AB")).toBe(false);
  });

  it("answered out of order, never replaces the buffer with either answer", () => {
    let buffer = "AB";
    const t = scenario(() => buffer);
    expect(t.answer(t.second)).toEqual({ sync: "in-sync", draft: "clean" });
    // The older answer arrives last: it confirms only "A", not what is shown.
    expect(t.answer(t.first)).toEqual({
      sync: "keep-later-edits",
      draft: "dirty",
    });

    buffer = "A";
    const u = scenario(() => buffer);
    expect(u.answer(u.second)).toEqual({
      sync: "keep-later-edits",
      draft: "dirty",
    });
    expect(u.answer(u.first)).toEqual({ sync: "in-sync", draft: "clean" });
  });

  it("tracks writes by identity, so a repeated text stays awaited until its own answer", () => {
    const writes = createSentCodeWrites();
    const one = { path: PATH, content: "same" };
    const two = { path: PATH, content: "same" };
    writes.sent(one);
    writes.sent(two);
    writes.answered(one);
    expect(writes.awaitsAnswer(PATH, "same")).toBe(true);
    writes.answered(two);
    expect(writes.awaitsAnswer(PATH, "same")).toBe(false);
    expect(writes.awaitsAnswer("src/other.ts", "same")).toBe(false);
  });
});

describe("a lost write", () => {
  it("stays tracked while the store holds it as unconfirmed, and no longer awaits an answer", () => {
    const writes = createSentCodeWrites();
    const write = { path: PATH, content: "A" };
    writes.sent(write);
    writes.lost(write);
    expect(writes.awaitsAnswer(PATH, "A")).toBe(false);
    expect(writes.settleLost(() => true)).toEqual([]);
    expect(writes.settleLost(() => false)).toEqual([write]);
    // Settled once.
    expect(writes.settleLost(() => false)).toEqual([]);
  });

  it("settles each lost write by its own unconfirmed state", () => {
    const writes = createSentCodeWrites();
    const hero = { path: PATH, content: "A" };
    const other = { path: "src/other.ts", content: "B" };
    writes.lost(hero);
    writes.lost(other);
    expect(writes.settleLost((write) => write === other)).toEqual([hero]);
    expect(writes.settleLost(() => false)).toEqual([other]);
  });

  it("confirms only itself once found to have landed", () => {
    expect(
      draftAfterLostWriteSettled({ lost: "a\n", serverContent: "a\n", draft: "a" }),
    ).toBe("dirty");
    expect(
      draftAfterLostWriteSettled({
        lost: "a\n",
        serverContent: "a\n",
        draft: "a\nb",
      }),
    ).toBe("dirty");
    expect(
      draftAfterLostWriteSettled({ lost: "a\n", serverContent: "a\n", draft: "a\n" }),
    ).toBe("clean");
  });

  it("says nothing about the buffer when it did not land", () => {
    expect(
      draftAfterLostWriteSettled({ lost: "a\n", serverContent: "a", draft: "a" }),
    ).toBe("untouched");
    expect(
      draftAfterLostWriteSettled({
        lost: "a\n",
        serverContent: undefined,
        draft: "a",
      }),
    ).toBe("untouched");
  });
});
