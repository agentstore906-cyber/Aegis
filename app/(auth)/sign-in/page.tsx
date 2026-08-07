import type { Metadata } from "next";
import { SignInForm } from "@/components/auth/sign-in-form";

export const metadata: Metadata = { title: "Sign in" };

export default function SignInPage() {
  return (
    <>
      <div className="mb-6 text-center">
        <h1 className="text-lg font-semibold text-foreground">Sign in to Aegis</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Welcome back. Enter your details to continue.
        </p>
      </div>
      <SignInForm />
    </>
  );
}
