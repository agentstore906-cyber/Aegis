import { z } from "zod";

export const teamNameSchema = z.object({
  name: z.string().trim().min(2, "Name must be at least 2 characters").max(60),
});

export type TeamNameInput = z.infer<typeof teamNameSchema>;
