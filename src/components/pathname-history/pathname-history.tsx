import { useLocation } from "@tanstack/react-router";
import { useEffect } from "react";

export function RegisterPathnameHistory() {
  const location = useLocation();

  useEffect(() => {
    if (
      !location.pathname.startsWith("/dashboard/settings") &&
      typeof window !== "undefined"
    ) {
      sessionStorage.setItem("redirected-path", location.pathname);
    }
  }, [location.pathname]);
  return null;
}

export function getRedirectedPath() {
  if (typeof window === "undefined") return null;
  return sessionStorage.getItem("redirected-path");
}
