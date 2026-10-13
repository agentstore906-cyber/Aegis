import { prisma } from "@/lib/db";
import { signInSchema } from "@/lib/validation/auth";
import { verifyPassword } from "@/lib/auth/password";
import { enforceSignInLimit } from "@/lib/auth/sign-in-limit";

/**
 * The Credentials provider's `authorize`. Throttling runs FIRST, before parsing or any database / bcrypt work, so
 * malformed requests cannot be used to avoid the limit or to burn CPU. Every route into credentials sign-in
 * (the `signIn` server action and `POST /api/auth/callback/credentials`) passes through here.
 */
export async function authorizeCredentials(raw: Partial<Record<string, unknown>> | undefined, request?: Pick<Request, "headers">) {
  await enforceSignInLimit(request, raw?.email);

  const parsed = signInSchema.safeParse(raw);
  if (!parsed.success) return null;

  const { email, password } = parsed.data;
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user?.passwordHash) return null;

  const isValid = await verifyPassword(password, user.passwordHash);
  if (!isValid) return null;

  return { id: user.id, name: user.name, email: user.email, image: user.image };
}
