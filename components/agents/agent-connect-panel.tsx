"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { KeyRound, CheckCircle2, Loader2, ArrowRight } from "lucide-react";

import { CodeBlock } from "@/components/ui/code-block";

/**
 * Shown on the agent detail overview until Aegis has received that agent's
 * first event. Every value here is real — the agent's own slug, this
 * deployment's origin, and whether the org actually has an unrevoked API
 * key — and the panel polls the server (via router.refresh) so it flips to
 * the normal activity view on its own the moment the first event lands.
 */
export function AgentConnectPanel({
  agentSlug,
  agentName,
  baseUrl,
  hasActiveApiKey,
}: {
  agentSlug: string;
  agentName: string;
  baseUrl: string;
  hasActiveApiKey: boolean;
}) {
  const router = useRouter();

  useEffect(() => {
    const interval = setInterval(() => router.refresh(), 5000);
    return () => clearInterval(interval);
  }, [router]);

  const curl = [
    `curl -X POST ${baseUrl}/api/v1/events \\`,
    `  -H "Authorization: Bearer $AEGIS_API_KEY" \\`,
    `  -H "Content-Type: application/json" \\`,
    `  -d '{`,
    `    "agent": "${agentSlug}",`,
    `    "eventType": "TOOL_CALL",`,
    `    "action": "test.connection",`,
    `    "resource": "aegis",`,
    `    "status": "SUCCESS"`,
    `  }'`,
  ].join("\n");

  return (
    <div className="rounded-lg border border-border bg-surface">
      <div className="border-b border-border px-5 py-4">
        <h2 className="text-sm font-semibold text-foreground">Finish connecting {agentName}</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Aegis hasn&rsquo;t received any activity from this agent yet. Send one event from your
          agent&rsquo;s runtime to complete the connection.
        </p>
      </div>

      <ol className="divide-y divide-border">
        <li className="flex items-start gap-3 px-5 py-4">
          <span className="mt-0.5 shrink-0">
            {hasActiveApiKey ? (
              <CheckCircle2 className="size-4 text-success" aria-hidden="true" />
            ) : (
              <KeyRound className="size-4 text-muted-foreground" aria-hidden="true" />
            )}
          </span>
          <div className="min-w-0">
            <p className="text-sm font-medium text-foreground">Create an API key</p>
            {hasActiveApiKey ? (
              <p className="mt-0.5 text-sm text-muted-foreground">
                Your organization already has an active key. Reuse it, or{" "}
                <Link href="/developers/api-keys" className="text-foreground underline">
                  create another
                </Link>
                .
              </p>
            ) : (
              <p className="mt-0.5 text-sm text-muted-foreground">
                <Link href="/developers/api-keys" className="text-foreground underline">
                  Create an organization API key
                </Link>{" "}
                with the <code>events:write</code> scope. You&rsquo;ll see the raw key once — export it
                as <code>AEGIS_API_KEY</code>.
              </p>
            )}
          </div>
        </li>

        <li className="flex items-start gap-3 px-5 py-4">
          <span className="mt-0.5 shrink-0 text-xs font-semibold text-muted-foreground">2</span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-foreground">Send a test event</p>
            <p className="mt-0.5 mb-3 text-sm text-muted-foreground">
              Run this from a server-side shell — never a browser. It&rsquo;s pre-filled with this
              agent&rsquo;s slug.
            </p>
            <CodeBlock code={curl} language="bash" />
          </div>
        </li>

        <li className="flex items-center gap-3 px-5 py-4">
          <Loader2 className="size-4 shrink-0 animate-spin text-muted-foreground" aria-hidden="true" />
          <p className="text-sm text-muted-foreground">
            Waiting for the first event&hellip; this page updates automatically.
          </p>
        </li>
      </ol>

      <div className="border-t border-border px-5 py-3">
        <Link
          href="/developers/quickstart"
          className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
        >
          Full quickstart — SDK, policy decisions, approvals
          <ArrowRight className="size-3" aria-hidden="true" />
        </Link>
      </div>
    </div>
  );
}
