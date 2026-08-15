import type { Metadata } from "next";
import { Mail, CirclePlay } from "lucide-react";
import { ButtonLink } from "@/components/ui/button";
import { LeadForm } from "@/components/marketing/lead-form";

export const metadata: Metadata = {
  title: "Contact",
  description: "Book a demo, talk to sales, or get in touch with the Aegis team.",
};

type SearchParams = Record<string, string | string[] | undefined>;

export default async function ContactPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const contactEmail = process.env.NEXT_PUBLIC_CONTACT_EMAIL;
  const raw = await searchParams;
  const sourceParam = typeof raw.source === "string" ? raw.source.toUpperCase() : undefined;
  const source = sourceParam === "ENTERPRISE" || sourceParam === "DEMO_REQUEST" ? sourceParam : "CONTACT";

  const copy =
    source === "ENTERPRISE"
      ? {
          eyebrow: "Enterprise",
          title: "Talk to an AI infrastructure specialist.",
          body: "Tell us about your deployment environment, agent count, and security requirements — we'll route this to someone who can speak to Enterprise needs directly.",
        }
      : {
          eyebrow: "Contact",
          title: "Talk to us.",
          body: "Tell us about the agents you're running and what you need to govern them. A real person reads every submission — no chatbot in between.",
        };

  return (
    <div className="mx-auto max-w-2xl px-6 py-20">
      <p className="text-sm font-medium text-muted-foreground">{copy.eyebrow}</p>
      <h1 className="mt-2 text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
        {copy.title}
      </h1>
      <p className="mt-4 text-lg text-muted-foreground">{copy.body}</p>

      <div className="mt-10 rounded-xl border border-border bg-surface p-6 sm:p-8">
        <LeadForm source={source} />
      </div>

      <div className="mt-8 grid gap-4 sm:grid-cols-2">
        <div className="rounded-xl border border-border bg-surface p-5">
          <div className="flex size-9 items-center justify-center rounded-full bg-surface-muted">
            <CirclePlay className="size-4 text-foreground" aria-hidden="true" />
          </div>
          <p className="mt-3 text-sm font-semibold text-foreground">Want to look first?</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Explore a fully interactive sample dashboard — no signup required.
          </p>
          <ButtonLink href="/demo" variant="secondary" className="mt-4 w-full">
            View demo
          </ButtonLink>
        </div>

        <div className="rounded-xl border border-border bg-surface p-5">
          <div className="flex size-9 items-center justify-center rounded-full bg-surface-muted">
            <Mail className="size-4 text-foreground" aria-hidden="true" />
          </div>
          <p className="mt-3 text-sm font-semibold text-foreground">Prefer email?</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {contactEmail
              ? "Reach us directly — same response time as the form."
              : "Email isn't configured for this deployment yet — use the form above."}
          </p>
          {contactEmail && (
            <ButtonLink href={`mailto:${contactEmail}?subject=Aegis%20-%20Talk%20to%20sales`} variant="secondary" className="mt-4 w-full">
              Email {contactEmail}
            </ButtonLink>
          )}
        </div>
      </div>

      <p className="mt-10 text-sm text-muted-foreground">
        Ready to try it yourself? <ButtonLink href="/sign-up" variant="ghost" size="sm">Start free</ButtonLink>
      </p>
    </div>
  );
}
