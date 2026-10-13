import { describe, expect, it } from "vitest";
import {
  createPreviewContentSync,
  type PreviewContentBehindReason,
  type PreviewContentSyncAnswer,
} from "./preview-content-sync";

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
};

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const applied = (ticket: number): PreviewContentSyncAnswer => ({
  success: true,
  data: { ticket },
});

const refused = (
  error: string,
  sentTicket: number,
  ticket = sentTicket - 1,
): PreviewContentSyncAnswer => ({ success: false, error, ticket, sentTicket });

/** Lets every settled promise run its continuations. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

function harness() {
  const syncs: Deferred<PreviewContentSyncAnswer>[] = [];
  const confirms: Array<{
    ticket: number;
    answer: Deferred<PreviewContentSyncAnswer>;
  }> = [];
  const refreshed: number[] = [];
  const behind: PreviewContentBehindReason[] = [];
  let editOpen = false;
  const sync = createPreviewContentSync({
    sync: () => {
      const answer = deferred<PreviewContentSyncAnswer>();
      syncs.push(answer);
      return answer.promise;
    },
    confirm: (ticket) => {
      const answer = deferred<PreviewContentSyncAnswer>();
      confirms.push({ ticket, answer });
      return answer.promise;
    },
    refresh: (ticket) => refreshed.push(ticket),
    canRefresh: () => !editOpen,
    onBehind: (reason) => behind.push(reason),
  });
  return {
    sync,
    syncs,
    confirms,
    refreshed,
    behind,
    setEditOpen: (open: boolean) => {
      editOpen = open;
    },
  };
}

describe("syncing saved content into a preview that reads it on the server", () => {
  it("refreshes the canvas only after the preview confirms the sync", async () => {
    const h = harness();
    h.sync.requestSync();
    await settle();
    expect(h.syncs).toHaveLength(1);
    // Sent, not yet confirmed: the canvas is left alone.
    expect(h.refreshed).toEqual([]);

    h.syncs[0]!.resolve(applied(7));
    await settle();
    expect(h.refreshed).toEqual([7]);
    expect(h.behind).toEqual([]);
  });

  it("sends one sync at a time and folds saves made meanwhile into one more", async () => {
    const h = harness();
    h.sync.requestSync();
    h.sync.requestSync();
    h.sync.requestSync();
    await settle();
    expect(h.syncs).toHaveLength(1);

    h.syncs[0]!.resolve(applied(1));
    await settle();
    // The two saves made while the first ran are carried by one sync.
    expect(h.syncs).toHaveLength(2);
    // And the older confirmation is not shown while that newer one runs.
    expect(h.refreshed).toEqual([]);

    h.syncs[1]!.resolve(applied(2));
    await settle();
    expect(h.syncs).toHaveLength(2);
    expect(h.refreshed).toEqual([2]);
  });

  it("ignores a confirmation older than one already shown", async () => {
    const h = harness();
    h.sync.requestSync();
    await settle();
    h.syncs[0]!.resolve(applied(5));
    await settle();
    expect(h.refreshed).toEqual([5]);

    // Another tab's newer sync was shown first; this one answers with less.
    h.sync.requestSync();
    await settle();
    h.syncs[1]!.resolve(applied(4));
    await settle();
    expect(h.refreshed).toEqual([5]);
  });

  it("still shows the confirmed content when the sync queued after it is refused", async () => {
    const h = harness();
    h.sync.requestSync();
    await settle();
    h.sync.requestSync();
    h.syncs[0]!.resolve(applied(3));
    await settle();
    h.syncs[1]!.resolve({
      success: false,
      error: "PREVIEW_CONTENT_UNSTABLE",
    });
    await settle();
    expect(h.refreshed).toEqual([3]);
    expect(h.behind).toEqual([
      { kind: "refused", error: "PREVIEW_CONTENT_UNSTABLE" },
    ]);
  });

  it("holds the refresh while an edit is open on the canvas, and shows it once the edit ends", async () => {
    const h = harness();
    h.setEditOpen(true);
    h.sync.requestSync();
    await settle();
    h.syncs[0]!.resolve(applied(9));
    await settle();
    expect(h.refreshed).toEqual([]);

    // Ended for any reason other than the edit closing: still held.
    h.sync.editEnded();
    expect(h.refreshed).toEqual([]);

    h.setEditOpen(false);
    h.sync.editEnded();
    expect(h.refreshed).toEqual([9]);
    // Once.
    h.sync.editEnded();
    expect(h.refreshed).toEqual([9]);
  });

  it("keeps a held refresh back when the edit ends while a newer sync runs", async () => {
    const h = harness();
    h.setEditOpen(true);
    h.sync.requestSync();
    await settle();
    h.syncs[0]!.resolve(applied(1));
    await settle();
    h.sync.requestSync();
    await settle();
    expect(h.syncs).toHaveLength(2);

    // The edit ends with ticket 1 held and ticket 2 on its way: showing 1
    // now would only be replaced a moment later.
    h.setEditOpen(false);
    h.sync.editEnded();
    expect(h.refreshed).toEqual([]);

    h.syncs[1]!.resolve(applied(2));
    await settle();
    expect(h.refreshed).toEqual([2]);
  });

  it("does not send again when no answer comes back", async () => {
    const h = harness();
    h.sync.requestSync();
    await settle();
    h.syncs[0]!.reject(new Error("network"));
    await settle();
    expect(h.syncs).toHaveLength(1);
    expect(h.confirms).toEqual([]);
    expect(h.refreshed).toEqual([]);
    expect(h.behind).toEqual([{ kind: "unanswered" }]);

    // The next save syncs again, as any save does.
    h.sync.requestSync();
    await settle();
    expect(h.syncs).toHaveLength(2);
  });

  it("asks once, without writing, about a sync written but not yet read", async () => {
    const h = harness();
    h.sync.requestSync();
    await settle();
    h.syncs[0]!.resolve(refused("PREVIEW_CONTENT_NOT_CONFIRMED", 12, 11));
    await settle();
    expect(h.confirms.map((confirm) => confirm.ticket)).toEqual([12]);
    expect(h.refreshed).toEqual([]);

    h.confirms[0]!.answer.resolve(applied(12));
    await settle();
    expect(h.syncs).toHaveLength(1);
    expect(h.refreshed).toEqual([12]);
    expect(h.behind).toEqual([]);
  });

  it("reports the preview as behind when the confirmation also says no", async () => {
    const h = harness();
    h.sync.requestSync();
    await settle();
    h.syncs[0]!.resolve(refused("PREVIEW_CONTENT_NOT_CONFIRMED", 12, 11));
    await settle();
    h.confirms[0]!.answer.resolve(
      refused("PREVIEW_CONTENT_NOT_CONFIRMED", 12, 11),
    );
    await settle();
    expect(h.syncs).toHaveLength(1);
    expect(h.confirms).toHaveLength(1);
    expect(h.refreshed).toEqual([]);
    expect(h.behind).toEqual([
      { kind: "refused", error: "PREVIEW_CONTENT_NOT_CONFIRMED" },
    ]);
  });

  it("confirms a superseded sync against its own ticket before showing the newer content", async () => {
    const h = harness();
    h.sync.requestSync();
    await settle();
    // The preview holds 20, taken after this save; it is asked whether it
    // reads 15 or later, not told to show 20 unread.
    h.syncs[0]!.resolve(refused("PREVIEW_CONTENT_SUPERSEDED", 15, 20));
    await settle();
    expect(h.confirms.map((confirm) => confirm.ticket)).toEqual([15]);
    h.confirms[0]!.answer.resolve(applied(20));
    await settle();
    expect(h.refreshed).toEqual([20]);
  });

  it("does not confirm a refusal that cannot become true by waiting", async () => {
    const h = harness();
    h.sync.requestSync();
    await settle();
    h.syncs[0]!.resolve(refused("PREVIEW_CONTENT_TICKET_CONFLICT", 8, 8));
    await settle();
    expect(h.confirms).toEqual([]);
    expect(h.behind).toEqual([
      { kind: "refused", error: "PREVIEW_CONTENT_TICKET_CONFLICT" },
    ]);
  });

  it("does not confirm a refusal that names no ticket of its own", async () => {
    const h = harness();
    h.sync.requestSync();
    await settle();
    h.syncs[0]!.resolve({
      success: false,
      error: "PREVIEW_CONTENT_NOT_CONFIRMED",
      ticket: 3,
    });
    await settle();
    expect(h.confirms).toEqual([]);
    expect(h.behind).toEqual([
      { kind: "refused", error: "PREVIEW_CONTENT_NOT_CONFIRMED" },
    ]);
  });

  it("changes nothing for answers that arrive after it is disposed", async () => {
    const h = harness();
    h.sync.requestSync();
    await settle();
    h.sync.dispose();
    h.syncs[0]!.resolve(applied(1));
    await settle();
    h.sync.requestSync();
    h.sync.editEnded();
    await settle();
    expect(h.syncs).toHaveLength(1);
    expect(h.refreshed).toEqual([]);
    expect(h.behind).toEqual([]);
  });

  it("raises no notice and asks nothing for a refusal that arrives after it is disposed", async () => {
    const h = harness();
    h.sync.requestSync();
    await settle();
    h.sync.dispose();
    h.syncs[0]!.resolve(refused("PREVIEW_CONTENT_NOT_CONFIRMED", 4, 3));
    await settle();
    expect(h.confirms).toEqual([]);
    expect(h.behind).toEqual([]);
  });
});
