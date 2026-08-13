/**
 * Shared CSV export plumbing for the dashboard's export routes
 * (/audit/export, /costs/export, /security/export). Streams rows as
 * they're fetched rather than materializing the whole export in memory —
 * spec §20/§44 ("pagination/streaming... avoid loading everything into
 * memory").
 */

const RISKY_LEADING_CHARS = new Set(["=", "+", "-", "@", "\t", "\r"]);

/**
 * Prevents CSV/formula injection: a field starting with a spreadsheet
 * formula character (=, +, -, @) gets a leading apostrophe so Excel/
 * Sheets render it as text, never evaluate it as a formula. Also handles
 * standard CSV quoting for commas, quotes, and newlines.
 */
export function csvField(value: unknown): string {
  let text = value === null || value === undefined ? "" : String(value);

  if (RISKY_LEADING_CHARS.has(text.charAt(0))) {
    text = `'${text}`;
  }

  if (/[",\n\r]/.test(text)) {
    text = `"${text.replace(/"/g, '""')}"`;
  }

  return text;
}

export function csvRow(fields: unknown[]): string {
  return fields.map(csvField).join(",") + "\r\n";
}

/**
 * Builds a streamed CSV response from a cursor-paginated fetcher. `fetchPage`
 * receives the last row's cursor (undefined for the first page) and must
 * return up to `pageSize` rows in a stable order; the stream ends when it
 * returns fewer than `pageSize` rows.
 */
export function createCsvResponse<Row>(options: {
  filename: string;
  headers: string[];
  pageSize?: number;
  toRow: (row: Row) => unknown[];
  getCursor: (row: Row) => string;
  fetchPage: (cursor: string | undefined, pageSize: number) => Promise<Row[]>;
}): Response {
  const pageSize = options.pageSize ?? 500;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder();
      controller.enqueue(encoder.encode(csvRow(options.headers)));

      let cursor: string | undefined;
      for (;;) {
        const page = await options.fetchPage(cursor, pageSize);
        for (const row of page) {
          controller.enqueue(encoder.encode(csvRow(options.toRow(row))));
        }
        if (page.length < pageSize) break;
        cursor = options.getCursor(page[page.length - 1]);
      }

      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${options.filename}"`,
    },
  });
}
