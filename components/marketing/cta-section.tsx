import { ButtonLink } from "@/components/ui/button";
import { TrackedButtonLink } from "@/components/analytics/tracked-button-link";

export function CtaSection() {
  return (
    <section className="border-t border-border">
      <div className="mx-auto max-w-6xl px-6 py-20 text-center">
        <h2 className="text-3xl font-semibold tracking-tight text-balance text-foreground">
          Your agents are already running. It&apos;s time to see what they&apos;re doing.
        </h2>
        <p className="mx-auto mt-4 max-w-xl text-muted-foreground">
          Start with visibility. Add control as your AI workforce grows.
        </p>
        <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <TrackedButtonLink href="/sign-up" size="lg" event="landing_cta_clicked" eventProps={{ source: "cta_section" }}>
            Start Free
          </TrackedButtonLink>
          <ButtonLink href="/pricing" variant="secondary" size="lg">
            View pricing
          </ButtonLink>
        </div>
      </div>
    </section>
  );
}
