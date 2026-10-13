"use server";

import { prisma } from "@/lib/db";
import { signUpSchema } from "@/lib/validation/auth";
import { hashPassword } from "@/lib/auth/password";
import { signIn, signOut } from "@/lib/auth";
import { trackEvent } from "@/lib/analytics/track";
import { SignInRateLimitedError, SIGN_IN_RATE_LIMITED_MESSAGE } from "@/lib/auth/sign-in-limit";
import { consumeClientLimit } from "@/lib/rate-limit/client-key";
import { getClientIp } from "@/lib/http/client-ip";
import { createRateLimiter } from "@/lib/rate-limit/postgres";

/**
 * Per-IP throttle on account creation. (Sign-in throttling lives in lib/auth/sign-in-limit.ts, enforced inside
 * `authorize` so it also covers the Auth.js credentials route.) Shared across instances when RATE_LIMIT_BACKEND=postgres,
 * the production default.
 */
const signUpRateLimiter = createRateLimiter("auth.sign_up", 5, 60 * 60 * 1000); // 5 accounts / hour / IP — mirrors the leads form's anti-spam threshold
// Used INSTEAD of the per-IP limiter when no trustworthy client IP exists (never a shared "unknown" bucket; see lib/rate-limit/client-key.ts).
const signUpEmailLimiter = createRateLimiter("auth.sign_up.email", 3, 60 * 60 * 1000);

export type SignUpState = {
  error?: string;
};

export async function signUpAction(
  _prevState: SignUpState,
  formData: FormData
): Promise<SignUpState> {
  const ip = await getClientIp();
  const rateLimit = await consumeClientLimit({ ip, ipLimiter: signUpRateLimiter, emailLimiter: signUpEmailLimiter, email: formData.get("email") });
  if (!rateLimit.allowed) {
    return { error: "Too many sign-up attempts. Please try again later." };
  }

  const parsed = signUpSchema.safeParse({
    name: formData.get("name"),
    email: formData.get("email"),
    password: formData.get("password"),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const { name, email, password } = parsed.data;

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    return { error: "An account with this email already exists" };
  }

  const passwordHash = await hashPassword(password);

  // Only the user is created here — no organization yet. Account type
  // (Personal/Team/Enterprise) is chosen in /onboarding right after sign-in,
  // and that's where the org + owner membership get created (immediately for
  // Personal, via a named workspace form for Team/Enterprise). See
  // createPersonalWorkspaceAction / createOrganizationAction in
  // lib/organizations/actions.ts.
  const user = await prisma.user.create({
    data: { name, email, passwordHash },
  });

  trackEvent("signup_completed", { userId: user.id });

  await signIn("credentials", {
    email,
    password,
    redirectTo: "/onboarding",
  });

  return {};
}

export type SignInState = {
  error?: string;
};

export async function signInAction(
  _prevState: SignInState,
  formData: FormData
): Promise<SignInState> {
  const email = formData.get("email");
  const password = formData.get("password");

  try {
    await signIn("credentials", {
      email,
      password,
      redirectTo: "/agents",
    });
  } catch (error) {
    if (error instanceof SignInRateLimitedError || (error as { code?: unknown } | null)?.code === "rate_limited") {
      return { error: SIGN_IN_RATE_LIMITED_MESSAGE };
    }
    if (error && typeof error === "object" && "type" in error) {
      return { error: "Invalid email or password" };
    }
    throw error;
  }

  return {};
}

export async function signOutAction() {
  await signOut({ redirectTo: "/" });
}
