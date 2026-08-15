import "server-only";

import { prisma } from "@/lib/db";
import type { CreateLeadInput } from "@/lib/validation/lead";
import type { LeadStatus } from "@prisma/client";

export async function createLead(input: CreateLeadInput) {
  return prisma.lead.create({ data: input });
}

export async function listLeads(status?: LeadStatus) {
  return prisma.lead.findMany({
    where: status ? { status } : undefined,
    orderBy: { createdAt: "desc" },
  });
}

export async function setLeadStatus(id: string, status: LeadStatus) {
  const result = await prisma.lead.updateMany({ where: { id }, data: { status } });
  return result.count > 0;
}

export async function countLeadsCreatedSince(email: string, since: Date) {
  return prisma.lead.count({ where: { email, createdAt: { gte: since } } });
}
