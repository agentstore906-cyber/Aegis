"use server";

import { prisma } from "@/lib/db";
import { signUpSchema } from "@/lib/validation/auth";
import { hashPassword } from "@/lib/auth/password";
import { signIn, signOut } from "@/lib/auth";
import { trackEvent } from "@/lib/analytics/track";
import { getClientIp } from "@/lib/http/client-ip";
import { InMemoryRateLimiter } from "@/lib/rate-limit/limiter";

/**
 * In-process, per-IP throttles on the two unauthenticated auth entry points.
 * Same known limitation as `apiRateLimiter` (lib/rate-limit/limiter.ts) and
 * `leadRateLimiter` (lib/leads/service.ts): state isn't shared across
 * instances, so a multi-instance deployment lets each instance independently
 * allow up to the limit. Swap in a Redis-backed `RateLimiter` for that case —
 * no call site here would need to change.
 */
const signInRateLimiter = new InMemoryRateLimiter(10, 10 * 60 * 1000); // 10 attempts / 10 min / IP — generous for a real user, useless for scripted guessing
const signUpRateLimiter = new InMemoryRateLimiter(5, 60 * 60 * 1000); // 5 accounts / hour / IP — mirrors the leads form's anti-spam threshold

export type SignUpState = {
  error?: string;
};

export async function signUpAction(
  _prevState: SignUpState,
  formData: FormData
): Promise<SignUpState> {
  const ip = await getClientIp();
  const rateLimit = await signUpRateLimiter.consume(ip);
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
  const ip = await getClientIp();
  const rateLimit = await signInRateLimiter.consume(ip);
  if (!rateLimit.allowed) {
    return { error: "Too many sign-in attempts. Please try again later." };
  }

  const email = formData.get("email");
  const password = formData.get("password");

  try {
    await signIn("credentials", {
      email,
      password,
      redirectTo: "/overview",
    });
  } catch (error) {
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
