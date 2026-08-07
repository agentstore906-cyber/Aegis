import "server-only";

import { redirect } from "next/navigation";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";

/**
 * Returns the authenticated user, or null. Use in Server Components that
 * need to branch on auth state without forcing a redirect.
 */
export async function getCurrentUser() {
  const session = await auth();
  if (!session?.user?.id) return null;

  return prisma.user.findUnique({ where: { id: session.user.id } });
}

/**
 * Returns the authenticated user or redirects to sign-in. Route protection
 * ultimately lives here and in proxy.ts — never rely on client-side checks
 * or hidden UI alone to gate access to a route.
 */
export async function requireUser() {
  const user = await getCurrentUser();
  if (!user) redirect("/sign-in");
  return user;
}
