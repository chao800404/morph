import { act, render, waitFor } from "@testing-library/react";
import { type ForwardedRef, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AUTHENTICATED_USER_ACTIVITY_EVENT } from "@/lib/auth/idle-activity";
import { readStoredReturnPath } from "@/lib/auth/return-path";
import {
  AUTH_IDLE_TIMER_CHANNEL,
  AUTH_IDLE_TIMER_SYNC_INTERVAL_MS,
  IdleTimerProvider,
} from "./idle-timer-provider";

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  providerProps: null as Record<string, unknown> | null,
  reset: vi.fn(),
  signOut: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/auth/authClient", () => ({
  default: () => ({ signOut: mocks.signOut }),
}));

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => mocks.navigate,
}));

vi.mock("better-auth/react", () => ({
  createAuthClient: () => ({
    useSession: () => ({ data: { user: { id: "user-1" } } }),
  }),
}));

vi.mock("react-idle-timer", async () => {
  const React = await import("react");
  return {
    IdleTimerProvider: React.forwardRef(
      (
        props: Record<string, unknown> & { children?: ReactNode },
        ref: ForwardedRef<unknown>,
      ) => {
        mocks.providerProps = props;
        React.useImperativeHandle(ref, () => ({ reset: mocks.reset }));
        return props.children;
      },
    ),
  };
});

describe("IdleTimerProvider cross-tab activity", () => {
  beforeEach(() => {
    mocks.navigate.mockClear();
    mocks.reset.mockClear();
    mocks.signOut.mockClear();
    window.sessionStorage.clear();
    window.history.replaceState({}, "", "/");
  });

  it("shares one timer channel and resets it for authenticated editor activity", () => {
    render(
      <IdleTimerProvider publicURL="https://editor.example.com">
        <div>Protected content</div>
      </IdleTimerProvider>,
    );

    expect(mocks.providerProps).toMatchObject({
      crossTab: true,
      leaderElection: true,
      name: AUTH_IDLE_TIMER_CHANNEL,
      syncTimers: AUTH_IDLE_TIMER_SYNC_INTERVAL_MS,
    });

    act(() => {
      window.dispatchEvent(new Event(AUTHENTICATED_USER_ACTIVITY_EVENT));
    });
    expect(mocks.reset).toHaveBeenCalledOnce();
  });

  it("allows only the elected tab to perform the shared logout", async () => {
    render(
      <IdleTimerProvider publicURL="https://editor.example.com">
        <div>Protected content</div>
      </IdleTimerProvider>,
    );
    const onIdle = mocks.providerProps?.onIdle as
      | ((event?: Event, timer?: { isLeader(): boolean }) => void)
      | undefined;

    onIdle?.(undefined, { isLeader: () => false });
    expect(mocks.signOut).not.toHaveBeenCalled();

    onIdle?.(undefined, { isLeader: () => true });
    await waitFor(() => expect(mocks.signOut).toHaveBeenCalledOnce());
    expect(mocks.navigate).toHaveBeenCalledWith({
      to: "/sign-in",
      search: { callbackURL: window.location.pathname },
    });
  });

  // An idle timeout is usually discovered long after it happened, often after
  // the tab was closed. The search param alone would not survive that, so the
  // path is persisted as well.
  it("persists the interrupted path so it outlives the tab", async () => {
    window.history.replaceState({}, "", "/dashboard/products?page=2");
    render(
      <IdleTimerProvider publicURL="https://editor.example.com">
        <div>Protected content</div>
      </IdleTimerProvider>,
    );
    const onIdle = mocks.providerProps?.onIdle as
      | ((event?: Event, timer?: { isLeader(): boolean }) => void)
      | undefined;

    onIdle?.(undefined, { isLeader: () => true });
    await waitFor(() => expect(mocks.signOut).toHaveBeenCalled());

    expect(readStoredReturnPath()).toBe("/dashboard/products?page=2");
    expect(mocks.navigate).toHaveBeenCalledWith({
      to: "/sign-in",
      search: { callbackURL: "/dashboard/products?page=2" },
    });
  });

  it("stores nothing when the timeout fires on an auth page", async () => {
    window.history.replaceState({}, "", "/sign-in");
    render(
      <IdleTimerProvider publicURL="https://editor.example.com">
        <div>Protected content</div>
      </IdleTimerProvider>,
    );
    const onIdle = mocks.providerProps?.onIdle as
      | ((event?: Event, timer?: { isLeader(): boolean }) => void)
      | undefined;

    onIdle?.(undefined, { isLeader: () => true });
    await waitFor(() => expect(mocks.signOut).toHaveBeenCalled());

    // Returning here after signing in would bounce the user straight back out.
    expect(readStoredReturnPath()).toBeNull();
    expect(mocks.navigate).toHaveBeenCalledWith({
      to: "/sign-in",
      search: { callbackURL: undefined },
    });
  });
});
