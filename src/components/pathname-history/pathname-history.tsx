import { useEffect } from "react";

export function RegisterPathnameHistory({ pathname }: { pathname: string }) {
  useEffect(() => {
    if (
      !pathname.startsWith("/dashboard/settings") &&
      typeof window !== "undefined"
    ) {
      sessionStorage.setItem("redirected-path", pathname);
    }
  }, [pathname]);
  return null;
}

export function getRedirectedPath() {
  if (typeof window === "undefined") return null;
  return sessionStorage.getItem("redirected-path");
}
