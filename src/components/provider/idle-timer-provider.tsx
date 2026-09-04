import authClient from "@/auth/authClient";
import { AUTHENTICATED_USER_ACTIVITY_EVENT } from "@/lib/auth/idle-activity";
import { currentReturnPath, storeReturnPath } from "@/lib/auth/return-path";
import { useNavigate } from "@tanstack/react-router";
import { createAuthClient } from "better-auth/react";
import { useEffect, useRef, useState } from "react";
import {
  IdleTimerProvider as Provider,
  type IIdleTimer,
  type PresenceType,
} from "react-idle-timer";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogHeader,
  AlertDialogTitle,
} from "../ui/alert-dialog";

const { useSession } = createAuthClient();
export const AUTH_IDLE_TIMER_CHANNEL = "morph-auth-session";
export const AUTH_IDLE_TIMER_SYNC_INTERVAL_MS = 1_000;

/**
 * Props for the IdleTimerProvider component
 */
interface IdleTimerProviderProps {
  /** The child components to render */
  children: React.ReactNode;
  /** Enable auto logout feature */
  enabled?: boolean;
  /** Timeout in minutes before logout */
  timeout?: number;
  /** Show prompt before idle in minutes */
  promptBeforeIdle?: number;
  publicURL?: string;
}

export const IdleTimerProvider = ({
  children,
  enabled = true,
  timeout = 30,
  promptBeforeIdle = 5, // Time BEFORE timeout to show prompt (not absolute time)
  publicURL,
}: IdleTimerProviderProps) => {
  const { data: session } = useSession();
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const idleTimerRef = useRef<IIdleTimer>(null!);

  // Control whether onAction should execute
  const shouldResetRef = useRef(false);

  const onPrompt = () => {
    setOpen(true);
    shouldResetRef.current = true;
    if (process.env.NODE_ENV === "development") {
      console.log("⚠️ User idle warning");
    }
  };

  const onIdle = (_event?: Event, idleTimer?: IIdleTimer) => {
    if (idleTimer && !idleTimer.isLeader()) return;

    // User is completely idle, perform logout
    if (process.env.NODE_ENV === "development") {
      console.log("🚪 User idle timeout - logging out");
    }

    handleLogout();
  };

  const handleLogout = async () => {
    if (!publicURL || publicURL.length <= 0) return;
    // Capture where the user was before signing out, both in the URL and in
    // storage. The search param drives the immediate redirect; the stored copy
    // is what survives closing the tab and coming back later, which is the
    // normal way an idle timeout is discovered.
    const currentPath = currentReturnPath();
    storeReturnPath(currentPath);

    // Sign out user
    await authClient(publicURL).signOut();

    // Redirect to sign-in with callback URL
    navigate({
      to: "/sign-in",
      search: { callbackURL: currentPath ?? undefined },
    });
  };

  const onPresenceChange = (presence: PresenceType) => {
    if (presence.type === "active") {
      shouldResetRef.current = true;
      toast.dismiss();
    }
  };

  const onAction = (_event?: Event, idleTimer?: IIdleTimer) => {
    // Only execute when shouldReset is true
    if (!shouldResetRef.current) {
      return;
    }

    if (process.env.NODE_ENV === "development") {
      console.log("🔄 Resetting timer");
    }

    // Reset the timer
    if (idleTimer) {
      idleTimer.reset();
      setOpen(false);
    }

    // Disable after one execution to avoid triggering on every action
    shouldResetRef.current = false;
  };

  useEffect(() => {
    const handleAuthenticatedUserActivity = () => {
      idleTimerRef.current?.reset();
      shouldResetRef.current = false;
      setOpen(false);
    };

    window.addEventListener(
      AUTHENTICATED_USER_ACTIVITY_EVENT,
      handleAuthenticatedUserActivity,
    );
    return () =>
      window.removeEventListener(
        AUTHENTICATED_USER_ACTIVITY_EVENT,
        handleAuthenticatedUserActivity,
      );
  }, []);

  if (!publicURL) return <>{children}</>;

  return (
    <Provider
      ref={idleTimerRef}
      timeout={1000 * 60 * timeout}
      promptBeforeIdle={1000 * 60 * promptBeforeIdle}
      onPresenceChange={onPresenceChange}
      onPrompt={onPrompt}
      onIdle={onIdle}
      onAction={onAction}
      crossTab
      name={AUTH_IDLE_TIMER_CHANNEL}
      syncTimers={AUTH_IDLE_TIMER_SYNC_INTERVAL_MS}
      leaderElection
      disabled={!session?.user || !enabled}
    >
      <AlertDialog open={open}>
        <AlertDialogContent className="pointer-events-none">
          <AlertDialogHeader>
            <AlertDialogTitle>Session Timeout Warning</AlertDialogTitle>
            <AlertDialogDescription>
              You have been inactive for a while. If you do not perform any
              action, you will be logged out automatically.
            </AlertDialogDescription>
          </AlertDialogHeader>
        </AlertDialogContent>
      </AlertDialog>
      {children}
    </Provider>
  );
};
