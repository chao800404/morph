import { getSession } from "@/server/auth/getSession";
import { createFileRoute, Outlet } from "@tanstack/react-router";
import { BgVideo } from "./_auth/-components/bg-video";

export const Route = createFileRoute("/_auth")({
  beforeLoad: async () => {
    const session = await getSession();
    return { session };
  },
  component: AuthLayout,
});

function AuthLayout() {
  return (
    <div className="bg-card relative overflow-hidden">
      <div
        className="absolute top-0 left-0 w-full h-full content-[''] z-10 pointer-events-none bg-[url('https://www.ui-layouts.com/noise.gif')]"
        style={{ opacity: 0.05 }}
      />
      <div className="z-30 relative">
        <Outlet />
      </div>
      <BgVideo videoSrc="/static/isolated-jelly-short.mp4" />
    </div>
  );
}
