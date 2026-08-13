import { z } from "zod";

export const API_KEY_ENVIRONMENTS = ["LIVE", "TEST"] as const;
export const API_KEY_EXPIRY_OPTIONS = ["", "30", "90", "365"] as const;

export const createApiKeySchema = z.object({
  name: z.string().trim().min(2, "Name must be at least 2 characters").max(60),
  environment: z.enum(API_KEY_ENVIRONMENTS),
  expiresInDays: z.enum(API_KEY_EXPIRY_OPTIONS).default(""),
});

export type CreateApiKeyInput = z.infer<typeof createApiKeySchema>;
