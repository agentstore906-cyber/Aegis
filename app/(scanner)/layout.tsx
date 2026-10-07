import { MarketingNav } from "@/components/marketing/nav";
import { MarketingFooter } from "@/components/marketing/footer";

/**
 * The free scanner shares the console's dark control-room theme end to end — header and footer included — so the
 * whole scan experience reads as one product. Same URLs as before (/scan, /scan/report/…); only the layout differs
 * from the light marketing pages.
 */
export default function ScannerLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="aegis-console flex min-h-screen flex-col">
      <MarketingNav />
      <main className="flex-1">{children}</main>
      <MarketingFooter />
    </div>
  );
}
