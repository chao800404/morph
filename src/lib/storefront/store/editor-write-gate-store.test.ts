// @vitest-environment node
import { beforeEach, describe, expect, it } from "vitest";
import {
  editorWriteGateFor,
  useEditorWriteGateStore,
} from "./editor-write-gate-store";

const themeA = { storefrontId: "store-1", themeId: "theme-a" };
const themeB = { storefrontId: "store-1", themeId: "theme-b" };
const gateOf = (scope: typeof themeA) =>
  editorWriteGateFor(useEditorWriteGateStore.getState().gates, scope);

beforeEach(() => useEditorWriteGateStore.setState({ gates: {} }));

describe("the editor write gate store", () => {
  it("opens once for one confirmation, however often it is pressed", () => {
    const store = useEditorWriteGateStore.getState();
    store.pause(themeA, "AUTH_REQUIRED", "theme");
    const epoch = store.beginVerification(themeA)!;
    store.finishVerification(themeA, epoch, "verified");
    const verifiedEpoch = gateOf(themeA).epoch;

    expect(store.confirmResume(themeA, verifiedEpoch)).toBe(true);
    expect(store.confirmResume(themeA, verifiedEpoch)).toBe(false);
    expect(store.confirmResume(themeA, gateOf(themeA).epoch)).toBe(false);
  });

  it("lets a verification answer only for the Theme it began on", () => {
    const store = useEditorWriteGateStore.getState();
    store.pause(themeA, "AUTH_REQUIRED", "theme");
    store.pause(themeB, "AUTH_REQUIRED", "theme");
    const epochA = store.beginVerification(themeA)!;

    // The author moves to Theme B while A's question is out; A's answer
    // arrives and must not touch B.
    const bBefore = gateOf(themeB);
    store.finishVerification(themeA, epochA, "verified");
    expect(gateOf(themeB)).toBe(bBefore);
    expect(gateOf(themeB).recovery).toBe("none");
    expect(gateOf(themeA).recovery).toBe("verified");
  });

  it("ignores an answer begun before the editor paused again", () => {
    const store = useEditorWriteGateStore.getState();
    store.pause(themeA, "AUTH_REQUIRED", "theme");
    const epoch = store.beginVerification(themeA)!;
    store.writerChanged(themeA);
    store.finishVerification(themeA, epoch, "verified");
    expect(gateOf(themeA).recovery).toBe("different-account");
  });
});
