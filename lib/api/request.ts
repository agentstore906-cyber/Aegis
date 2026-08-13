import { ApiError } from "@/lib/api/errors";

/**
 * Reads and size-caps a request body before ever handing it to JSON.parse
 * or a Zod schema — protects the policy engine and the database from
 * unbounded input, per spec §13. Checked against the actual decoded byte
 * length, not the (spoofable, sometimes absent under chunked encoding)
 * Content-Length header.
 */
export async function readJsonBody(request: Request, maxBytes: number): Promise<unknown> {
  const text = await request.text();

  if (Buffer.byteLength(text, "utf8") > maxBytes) {
    throw new ApiError("PAYLOAD_TOO_LARGE", `Request body exceeds the ${maxBytes}-byte limit.`, 413);
  }

  if (text.trim() === "") return {};

  try {
    return JSON.parse(text);
  } catch {
    throw new ApiError("INVALID_REQUEST", "Request body must be valid JSON.", 400);
  }
}
