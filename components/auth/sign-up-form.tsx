"use client";

import { useActionState, useEffect } from "react";
import Link from "next/link";
import { signUpAction, type SignUpState } from "@/lib/auth/actions";
import { Label, Input } from "@/components/ui/field";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { trackEvent } from "@/lib/analytics/track";

const initialState: SignUpState = {};

export function SignUpForm() {
  const [state, formAction, pending] = useActionState(signUpAction, initialState);

  useEffect(() => {
    trackEvent("signup_started");
  }, []);

  return (
    <form action={formAction} className="space-y-4" noValidate>
      {state.error && <Alert tone="danger">{state.error}</Alert>}

      <div>
        <Label htmlFor="name">Name</Label>
        <Input id="name" name="name" type="text" autoComplete="name" required maxLength={100} />
      </div>

      <div>
        <Label htmlFor="email">Work email</Label>
        <Input id="email" name="email" type="email" autoComplete="email" required />
      </div>

      <div>
        <Label htmlFor="password">Password</Label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          required
          minLength={8}
        />
      </div>

      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? "Creating account…" : "Create account"}
      </Button>

      <p className="text-center text-sm text-muted-foreground">
        Already have an account?{" "}
        <Link href="/sign-in" className="font-medium text-foreground hover:underline">
          Sign in
        </Link>
      </p>
    </form>
  );
}
