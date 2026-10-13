import { createFileRoute } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import Hero from "../components/Hero";
import { morph } from "../morph/content";

const getHome = createServerFn().handler(() => morph.pages.get("/"));

export const Route = createFileRoute("/")({
  loader: () => getHome(),
  component: Home,
});

function Home() {
  const { hero } = Route.useLoaderData();
  return (
    <main>
      <Hero {...hero} />
    </main>
  );
}
