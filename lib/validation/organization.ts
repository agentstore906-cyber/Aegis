import { z } from "zod";

export const createOrganizationSchema = z.object({
  name: z.string().trim().min(2, "Organization name is too short").max(80),
});

export type CreateOrganizationInput = z.infer<typeof createOrganizationSchema>;
