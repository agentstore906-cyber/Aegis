"use client";

import { useState } from "react";
import Link from "next/link";
import { Menu, X } from "lucide-react";
import { ButtonLink } from "@/components/ui/button";
import { TrackedButtonLink } from "@/components/analytics/tracked-button-link";

export function MobileNav({ links }: { links: { href: string; label: string }[] }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="md:hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls="mobile-nav-panel"
        aria-label={open ? "Close menu" : "Open menu"}
        className="focus-ring flex size-9 items-center justify-center rounded-md border border-border"
      >
        {open ? <X className="size-4" /> : <Menu className="size-4" />}
      </button>

      {open && (
        <div
          id="mobile-nav-panel"
          className="absolute inset-x-0 top-16 border-b border-border bg-background px-6 py-4"
        >
          <nav className="flex flex-col gap-4" aria-label="Mobile">
            {links.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                onClick={() => setOpen(false)}
                className="text-sm text-foreground"
              >
                {link.label}
              </Link>
            ))}
          </nav>
          <div className="mt-4 flex flex-col gap-2">
            <ButtonLink href="/sign-in" variant="secondary" size="sm">
              Sign In
            </ButtonLink>
            <ButtonLink href="/contact" variant="secondary" size="sm">
              Book a Demo
            </ButtonLink>
            <TrackedButtonLink
              href="/sign-up"
              variant="primary"
              size="sm"
              event="landing_cta_clicked"
              eventProps={{ source: "mobile_nav" }}
            >
              Start Free
            </TrackedButtonLink>
          </div>
        </div>
      )}
    </div>
  );
}
