"use server";

import { cookies } from "next/headers";

import { prisma } from "@/lib/db";
import { signUpSchema } from "@/lib/validation/auth";
import { hashPassword } from "@/lib/auth/password";
import { signIn, signOut } from "@/lib/auth";
import { trackEvent } from "@/lib/analytics/track";
import { getClientIp } from "@/lib/http/client-ip";
import { InMemoryRateLimiter } from "@/lib/rate-limit/limiter";
import { ACTIVE_ORG_COOKIE, uniqueSlugFor } from "@/lib/organizations/queries";

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

  // User, organization, and owner membership are created together — a user
  // row must never exist without the org/membership a signed-in session
  // depends on to reach the dashboard (see requireActiveOrganization()).
  const { user, organization } = await prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: { name, email, passwordHash },
    });

    const organizationName = `${name}'s Organization`;
    const slug = await uniqueSlugFor(organizationName, tx);
    const organization = await tx.organization.create({
      data: {
        name: organizationName,
        slug,
        members: { create: { userId: user.id, role: "OWNER" } },
      },
    });

    return { user, organization };
  });

  trackEvent("signup_completed", { userId: user.id });
  trackEvent("workspace_created", { organizationId: organization.id });

  const cookieStore = await cookies();
  cookieStore.set(ACTIVE_ORG_COOKIE, organization.slug, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });

  await signIn("credentials", {
    email,
    password,
    redirectTo: "/overview",
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
