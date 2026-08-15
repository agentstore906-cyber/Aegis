import { z } from "zod";

const LEAD_SOURCES = ["CONTACT", "DEMO_REQUEST", "ENTERPRISE"] as const;

export const createLeadSchema = z.object({
  name: z.string().trim().min(1, "Enter your name").max(120),
  email: z.string().trim().toLowerCase().email("Enter a valid work email").max(200),
  company: z.string().trim().min(1, "Enter your company").max(160),
  role: z.string().trim().min(1, "Enter your role").max(120),
  agentCount: z.string().trim().max(40).optional(),
  aiStack: z.string().trim().max(200).optional(),
  primaryChallenge: z.string().trim().max(200).optional(),
  message: z.string().trim().max(2000).optional(),
  source: z.enum(LEAD_SOURCES).default("CONTACT"),
});

export type CreateLeadInput = z.infer<typeof createLeadSchema>;

export const LEAD_STATUSES = [
  "NEW",
  "CONTACTED",
  "QUALIFIED",
  "DEMO_SCHEDULED",
  "TRIAL",
  "CUSTOMER",
  "DISQUALIFIED",
] as const;

export const updateLeadStatusSchema = z.object({
  id: z.string().cuid(),
  status: z.enum(LEAD_STATUSES),
});
