import type { Metadata } from "next";

import { Logo } from "@/components/ui/logo";
import { ButtonLink } from "@/components/ui/button";

export const metadata: Metadata = { title: "Page not found" };

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-surface-muted px-6 py-12 text-center">
      <Logo className="mb-8" />
      <p className="text-sm font-medium text-muted-foreground">404</p>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight text-foreground">
        This page doesn&rsquo;t exist
      </h1>
      <p className="mt-2 max-w-sm text-sm text-muted-foreground">
        The page you&rsquo;re looking for may have been moved, or the link was mistyped.
      </p>
      <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
        <ButtonLink href="/overview">Go to dashboard</ButtonLink>
        <ButtonLink href="/" variant="secondary">
          Back to home
        </ButtonLink>
      </div>
    </div>
  );
}
