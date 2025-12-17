import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  component: App,
});

function App() {
  return (
    <div className="flex items-center justify-center min-h-screen p-8 font-[family-name:var(--font-geist-sans)]">
      app
    </div>
  );
}
