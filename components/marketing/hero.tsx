import { ButtonLink } from "@/components/ui/button";
import { ProductVisual } from "@/components/marketing/product-visual";
import { TrackedButtonLink } from "@/components/analytics/tracked-button-link";

export function Hero() {
  return (
    <section className="mx-auto max-w-6xl px-6 pt-16 pb-20 sm:pt-24 sm:pb-28">
      <div className="mx-auto max-w-3xl text-center">
        <p className="text-sm font-medium text-muted-foreground">
          AI Agent Infrastructure
        </p>
        <h1 className="mt-4 text-4xl font-semibold tracking-tight text-balance text-foreground sm:text-5xl">
          The Control Center for AI Agents.
        </h1>
        <p className="mx-auto mt-5 max-w-2xl text-lg text-pretty text-muted-foreground">
          Control every AI agent you use — monitor, control, and secure them from one place.
        </p>

        <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <TrackedButtonLink href="/scan" size="lg" event="landing_cta_clicked" eventProps={{ source: "hero_scan" }}>
            Free Risk Scanner
          </TrackedButtonLink>
          <TrackedButtonLink href="/sign-up" variant="secondary" size="lg" event="landing_cta_clicked" eventProps={{ source: "hero" }}>
            Create a free account
          </TrackedButtonLink>
        </div>
        <p className="mt-3 text-sm text-muted-foreground">Connect a real agent, then scan it. Free.</p>
        <p className="mt-2">
          <ButtonLink href="/demo" variant="ghost" size="sm">
            Or explore the interactive demo →
          </ButtonLink>
          <ButtonLink href="/contact" variant="ghost" size="sm">
            Book a demo
          </ButtonLink>
        </p>

        <p className="mt-6 text-sm text-muted-foreground">
          Built for individuals, teams, and enterprises running AI agents in production.
        </p>
      </div>

      <div className="mt-16">
        <ProductVisual />
      </div>
    </section>
  );
}
