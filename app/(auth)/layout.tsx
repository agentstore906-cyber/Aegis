import Link from "next/link";
import { Logo } from "@/components/ui/logo";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-surface-muted px-6 py-12">
      <Link href="/" className="focus-ring mb-8 rounded-sm">
        <Logo />
      </Link>
      <div className="w-full max-w-sm rounded-xl border border-border bg-surface p-7 shadow-sm">
        {children}
      </div>
    </div>
  );
}
