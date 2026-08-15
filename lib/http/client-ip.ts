import "server-only";

import { headers } from "next/headers";

/** Best-effort caller IP from proxy headers — used as a rate-limit key, never as an authorization decision. */
export async function getClientIp(): Promise<string> {
  const headerList = await headers();
  const forwardedFor = headerList.get("x-forwarded-for");
  if (forwardedFor) return forwardedFor.split(",")[0]!.trim();
  return headerList.get("x-real-ip") ?? "unknown";
}
