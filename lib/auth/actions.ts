"use server";

import { prisma } from "@/lib/db";
import { signUpSchema } from "@/lib/validation/auth";
import { hashPassword } from "@/lib/auth/password";
import { signIn, signOut } from "@/lib/auth";
import { trackEvent } from "@/lib/analytics/track";

export type SignUpState = {
  error?: string;
};

export async function signUpAction(
  _prevState: SignUpState,
  formData: FormData
): Promise<SignUpState> {
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
