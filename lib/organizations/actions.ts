"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth/session";
import { createOrganizationSchema } from "@/lib/validation/organization";
import { slugify } from "@/lib/utils";
import { ACTIVE_ORG_COOKIE } from "@/lib/organizations/queries";

export type CreateOrganizationState = {
  error?: string;
};

async function uniqueSlugFor(name: string): Promise<string> {
  const base = slugify(name);
  let candidate = base;
  let suffix = 1;

  while (await prisma.organization.findUnique({ where: { slug: candidate } })) {
    suffix += 1;
    candidate = `${base}-${suffix}`;
  }

  return candidate;
}

export async function createOrganizationAction(
  _prevState: CreateOrganizationState,
  formData: FormData
): Promise<CreateOrganizationState> {
  const user = await requireUser();

  const parsed = createOrganizationSchema.safeParse({
    name: formData.get("name"),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid organization name" };
  }

  const slug = await uniqueSlugFor(parsed.data.name);

  const organization = await prisma.organization.create({
    data: {
      name: parsed.data.name,
      slug,
      members: {
        create: { userId: user.id, role: "OWNER" },
      },
    },
  });

  const cookieStore = await cookies();
  cookieStore.set(ACTIVE_ORG_COOKIE, organization.slug, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });

  redirect("/overview");
}
