import { ButtonLink } from "@/components/ui/button";

export function CtaSection() {
  return (
    <section className="border-t border-border">
      <div className="mx-auto max-w-6xl px-6 py-20 text-center">
        <h2 className="text-3xl font-semibold tracking-tight text-foreground">
          Know exactly what your agents are doing.
        </h2>
        <p className="mx-auto mt-4 max-w-xl text-muted-foreground">
          Start with visibility. Add control as your AI workforce grows.
        </p>
        <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <ButtonLink href="/sign-up" size="lg">
            Get started
          </ButtonLink>
          <ButtonLink href="/pricing" variant="secondary" size="lg">
            View pricing
          </ButtonLink>
        </div>
      </div>
    </section>
  );
}
