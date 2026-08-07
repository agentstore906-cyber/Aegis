import { ButtonLink } from "@/components/ui/button";
import { ProductVisual } from "@/components/marketing/product-visual";

export function Hero() {
  return (
    <section className="mx-auto max-w-6xl px-6 pt-16 pb-20 sm:pt-24 sm:pb-28">
      <div className="mx-auto max-w-3xl text-center">
        <p className="text-sm font-medium text-muted-foreground">
          The AI Agent Control Plane
        </p>
        <h1 className="mt-4 text-4xl font-semibold tracking-tight text-balance text-foreground sm:text-5xl">
          Control every AI agent in your company.
        </h1>
        <p className="mx-auto mt-5 max-w-2xl text-lg text-pretty text-muted-foreground">
          See what your agents do, control what they can access, and stay ahead of risky
          actions from one control plane.
        </p>

        <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <ButtonLink href="/sign-up" size="lg">
            Get started
          </ButtonLink>
          <ButtonLink href="#product" variant="secondary" size="lg">
            View product
          </ButtonLink>
        </div>

        <p className="mt-6 text-sm text-muted-foreground">
          Built for teams running AI agents in production.
        </p>
      </div>

      <div className="mt-16">
        <ProductVisual />
      </div>
    </section>
  );
}
