import "server-only";

import { headers } from "next/headers";

import { clientIpFromHeaders } from "@/lib/http/client-ip-headers";

/** Best-effort caller IP from proxy headers — used as a rate-limit key, never as an authorization decision. */
export async function getClientIp(): Promise<string> {
  return clientIpFromHeaders(await headers());
}
