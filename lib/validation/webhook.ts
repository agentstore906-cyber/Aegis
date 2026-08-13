import { z } from "zod";
import { WEBHOOK_EVENT_TYPES } from "@/lib/webhooks/types";

export { WEBHOOK_EVENT_TYPES };

export const createWebhookEndpointSchema = z.object({
  url: z.string().trim().url("Enter a valid URL").max(500),
  subscribedEvents: z.array(z.enum(WEBHOOK_EVENT_TYPES)).min(1, "Select at least one event to subscribe to"),
});

export type CreateWebhookEndpointInput = z.infer<typeof createWebhookEndpointSchema>;
