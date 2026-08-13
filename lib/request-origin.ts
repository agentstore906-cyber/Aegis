import "server-only";

import { headers } from "next/headers";

/** The current request's origin, used to show a copy-pasteable `baseUrl` for the SDK/API. */
export async function getCurrentOrigin(): Promise<string> {
  const headerList = await headers();
  const host = headerList.get("host") ?? "localhost:3000";
  const protocol = headerList.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${protocol}://${host}`;
}
