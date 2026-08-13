import type { Metadata } from "next";
import { Mail, CirclePlay } from "lucide-react";
import { ButtonLink } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";

export const metadata: Metadata = {
  title: "Contact",
  description: "Talk to sales, book a demo, or get in touch with the Aegis team.",
};

export default function ContactPage() {
  const contactEmail = process.env.NEXT_PUBLIC_CONTACT_EMAIL;

  return (
    <div className="mx-auto max-w-2xl px-6 py-20">
      <p className="text-sm font-medium text-muted-foreground">Contact</p>
      <h1 className="mt-2 text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
        Talk to us.
      </h1>
      <p className="mt-4 text-lg text-muted-foreground">
        Questions about a company deployment, an Enterprise plan, or want a walkthrough before signing up? Reach out,
        or explore the interactive demo yourself first.
      </p>

      <div className="mt-10 grid gap-4 sm:grid-cols-2">
        <div className="rounded-xl border border-border bg-surface p-6">
          <div className="flex size-9 items-center justify-center rounded-full bg-surface-muted">
            <Mail className="size-4 text-foreground" aria-hidden="true" />
          </div>
          <p className="mt-3 text-sm font-semibold text-foreground">Talk to sales</p>
          <p className="mt-1 text-sm text-muted-foreground">
            For Enterprise plans, custom requirements, or a guided walkthrough.
          </p>
          {contactEmail ? (
            <ButtonLink href={`mailto:${contactEmail}?subject=Aegis%20-%20Talk%20to%20sales`} className="mt-4 w-full">
              Email {contactEmail}
            </ButtonLink>
          ) : (
            <div className="mt-4">
              <Alert tone="warning">
                Contact isn&rsquo;t configured for this deployment yet. Set{" "}
                <code className="rounded border border-border bg-surface px-1 py-0.5 text-xs">
                  NEXT_PUBLIC_CONTACT_EMAIL
                </code>{" "}
                to enable this.
              </Alert>
            </div>
          )}
        </div>

        <div className="rounded-xl border border-border bg-surface p-6">
          <div className="flex size-9 items-center justify-center rounded-full bg-surface-muted">
            <CirclePlay className="size-4 text-foreground" aria-hidden="true" />
          </div>
          <p className="mt-3 text-sm font-semibold text-foreground">See it first</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Explore a fully interactive sample dashboard — no signup required.
          </p>
          <ButtonLink href="/demo" variant="secondary" className="mt-4 w-full">
            View demo
          </ButtonLink>
        </div>
      </div>

      <p className="mt-10 text-sm text-muted-foreground">
        Ready to try it yourself? <ButtonLink href="/sign-up" variant="ghost" size="sm">Start free</ButtonLink>
      </p>
    </div>
  );
}
