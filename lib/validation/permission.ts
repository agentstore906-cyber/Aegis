import { z } from "zod";
import { POLICY_DECISIONS, actionSchema } from "@/lib/validation/policy";

export const agentPermissionSchema = z.object({
  action: actionSchema,
  resource: z.string().trim().max(80).optional().or(z.literal("")),
  decision: z.enum(POLICY_DECISIONS),
  description: z.string().trim().max(300).optional().or(z.literal("")),
});

export type AgentPermissionFormInput = z.infer<typeof agentPermissionSchema>;

export const permissionFiltersSchema = z.object({
  q: z.string().trim().max(120).optional(),
  decision: z.enum(POLICY_DECISIONS).optional(),
});

export type PermissionFiltersInput = z.infer<typeof permissionFiltersSchema>;
