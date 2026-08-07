import type { Metadata } from "next";
import { SignUpForm } from "@/components/auth/sign-up-form";

export const metadata: Metadata = { title: "Create your account" };

export default function SignUpPage() {
  return (
    <>
      <div className="mb-6 text-center">
        <h1 className="text-lg font-semibold text-foreground">Create your account</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Start controlling your AI agents in minutes.
        </p>
      </div>
      <SignUpForm />
    </>
  );
}
