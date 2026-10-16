export type HeroProps = {
  title?: string;
  subtitle?: string;
};

export default function Hero({
  title = "CASE-A-DEFAULT-TITLE",
  subtitle = "CASE-A-DEFAULT-SUBTITLE",
}: HeroProps) {
  return (
    <section data-case-a-hero>
      <h1>{title}</h1>
      <p>{subtitle}</p>
    </section>
  );
}
