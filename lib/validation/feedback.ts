import { z } from "zod";

export const createFeatureRequestSchema = z.object({
  title: z.string().trim().min(1, "Enter a title").max(160),
  description: z.string().trim().max(4000).optional(),
  category: z.string().trim().max(80).optional(),
});

export type CreateFeatureRequestInput = z.infer<typeof createFeatureRequestSchema>;

export const FEATURE_REQUEST_STATUSES = [
  "REQUESTED",
  "REVIEWING",
  "PLANNED",
  "IN_PROGRESS",
  "SHIPPED",
  "DECLINED",
] as const;

export const updateFeatureRequestStatusSchema = z.object({
  id: z.string().cuid(),
  status: z.enum(FEATURE_REQUEST_STATUSES),
});
