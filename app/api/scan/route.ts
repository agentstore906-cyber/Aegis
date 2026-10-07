/**
 * The questionnaire scanner (a self-assessment that produced a score) is retired. Scanning is now Scan Agent on a
 * real, connected agent, inside the dashboard (/risk-scan). This endpoint no longer accepts or returns scans.
 */
const GONE = () =>
  Response.json(
    { error: { code: "GONE", message: "The questionnaire scanner has been retired. Connect an agent and use Scan Agent in the Free Risk Scanner." } },
    { status: 410 }
  );

export const GET = GONE;
export const POST = GONE;
export const PUT = GONE;
export const PATCH = GONE;
export const DELETE = GONE;
