import authClient from "@/auth/authClient";
import { useNavigate } from "@tanstack/react-router";
import { createAuthClient } from "better-auth/react";
import { useRef, useState } from "react";
import {
  IIdleTimer,
  PresenceType,
  IdleTimerProvider as Provider,
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

  // Control whether onAction should execute
  const shouldResetRef = useRef(false);

  const onPrompt = () => {
    setOpen(true);
    shouldResetRef.current = true;
    if (process.env.NODE_ENV === "development") {
      console.log("⚠️ User idle warning");
    }
  };

  const onIdle = () => {
    // User is completely idle, perform logout
    if (process.env.NODE_ENV === "development") {
      console.log("🚪 User idle timeout - logging out");
    }

    handleLogout();
  };

  const handleLogout = async () => {
    if (!publicURL || publicURL.length <= 0) return;
    // Save current path before logout
    const currentPath = window.location.pathname + window.location.search;

    // Sign out user
    await authClient(publicURL).signOut();

    // Redirect to sign-in with callback URL
    navigate({
      to: "/sign-in",
      search: { callbackURL: currentPath },
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

  if (!publicURL) return <>{children}</>;

  return (
    <Provider
      timeout={1000 * 60 * timeout}
      promptBeforeIdle={1000 * 60 * promptBeforeIdle}
      onPresenceChange={onPresenceChange}
      onPrompt={onPrompt}
      onIdle={onIdle}
      onAction={onAction}
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
