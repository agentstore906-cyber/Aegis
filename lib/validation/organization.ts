import { z } from "zod";

export const createOrganizationSchema = z.object({
  name: z.string().trim().min(2, "Organization name is too short").max(80),
});

export type CreateOrganizationInput = z.infer<typeof createOrganizationSchema>;

export const MEMBER_ROLES = ["OWNER", "ADMIN", "ENGINEER", "SECURITY", "FINANCE", "VIEWER"] as const;

export const inviteMemberSchema = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email address").max(200),
  role: z.enum(MEMBER_ROLES),
});

export type InviteMemberInput = z.infer<typeof inviteMemberSchema>;

export const changeMemberRoleSchema = z.object({
  role: z.enum(MEMBER_ROLES),
});

export const RETENTION_FIELD_NAMES = ["activityRetentionDays", "auditRetentionDays", "securityRetentionDays"] as const;

const optionalRetentionDays = z
  .string()
  .trim()
  .optional()
  .transform((raw, ctx) => {
    if (!raw) return null;
    const parsed = Number(raw);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 3650) {
      ctx.addIssue({ code: "custom", message: "Retention must be a whole number of days between 1 and 3650, or left blank." });
      return null;
    }
    return parsed;
  });

export const retentionSettingsSchema = z.object({
  activityRetentionDays: optionalRetentionDays,
  auditRetentionDays: optionalRetentionDays,
  securityRetentionDays: optionalRetentionDays,
});

export type RetentionSettingsInput = z.infer<typeof retentionSettingsSchema>;

export const organizationGeneralSchema = z.object({
  name: z.string().trim().min(2, "Organization name is too short").max(80),
});
