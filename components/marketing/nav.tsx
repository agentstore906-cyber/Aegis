import Link from "next/link";
import { Logo } from "@/components/ui/logo";
import { ButtonLink } from "@/components/ui/button";
import { MobileNav } from "@/components/marketing/mobile-nav";
import { TrackedButtonLink } from "@/components/analytics/tracked-button-link";

const LINKS = [
  { href: "/#preview", label: "Product" },
  { href: "/#solution", label: "Solutions" },
  { href: "/#developers", label: "Developers" },
  { href: "/pricing", label: "Pricing" },
];

export function MarketingNav() {
  return (
    <header className="sticky top-0 z-40 border-b border-border bg-background/80 backdrop-blur-sm">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
        <Link href="/" className="focus-ring rounded-sm">
          <Logo />
        </Link>

        <nav className="hidden items-center gap-8 md:flex" aria-label="Primary">
          {LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="focus-ring rounded-sm text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              {link.label}
            </Link>
          ))}
        </nav>

        <div className="hidden items-center gap-3 md:flex">
          <ButtonLink href="/sign-in" variant="ghost" size="sm">
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
            eventProps={{ source: "nav" }}
          >
            Start Free
          </TrackedButtonLink>
        </div>

        <MobileNav links={LINKS} />
      </div>
    </header>
  );
}
