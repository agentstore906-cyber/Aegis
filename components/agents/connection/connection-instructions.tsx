"use client";

import { useEffect, useState } from "react";

import { CodeBlock } from "@/components/ui/code-block";
import { CopyButton } from "@/components/ui/copy-button";
import { cn } from "@/lib/utils";

type Method = "http" | "sdk";

/**
 * The setup for ONE agent, generated from the credential Aegis just issued.
 *
 * The default is plain HTTP because it works today for any language with nothing to install. The SDK is shown as
 * early access and never with an install command: `@aegis/agent-sdk` is not published to a public registry, so telling a
 * customer to `npm install` it would send them to a 404. The credential is referenced as an environment variable in
 * what is shown; "Copy setup" copies a ready-to-run version with the real key in it, only when the user asks.
 *
 * The setup says hello (handshake) AND reports one real event ("agent.started"), because a handshake proves the agent
 * reached Aegis while monitoring only starts once an event arrives.
 */
export function ConnectionInstructions({ secret }: { secret?: string }) {
  const [origin, setOrigin] = useState("https://YOUR-AEGIS-URL");
  const [method, setMethod] = useState<Method>("http");
  useEffect(() => {
    const t = setTimeout(() => setOrigin(window.location.origin), 0);
    return () => clearTimeout(t);
  }, []);

  const httpLines = (key: string) => [
    `export AEGIS_API_KEY="${key}"`,
    "",
    "# Say hello. Your key already says which agent this is.",
    `curl -X POST ${origin}/api/v1/connect/handshake \\`,
    '  -H "Authorization: Bearer $AEGIS_API_KEY"',
    "",
    "# Report the first thing your agent does, so monitoring starts.",
    `curl -X POST ${origin}/api/v1/events \\`,
    '  -H "Authorization: Bearer $AEGIS_API_KEY" \\',
    '  -H "Content-Type: application/json" \\',
    `  -d '{"eventType":"SYSTEM","action":"agent.started"}'`,
  ];
  const http = httpLines("<your credential>").join("\n");

  const sdk = [
    'import { Aegis } from "@aegis/agent-sdk";',
    "",
    "const aegis = new Aegis({",
    "  apiKey: process.env.AEGIS_API_KEY!,",
    `  baseUrl: "${origin}",`,
    "});",
    "",
    "await aegis.handshake(); // safe to repeat",
    'await aegis.track({ eventType: "SYSTEM", action: "agent.started" });',
  ].join("\n");

  // "Copy setup" always copies something that works today: the HTTP setup. (The SDK tab is early access, not installable.)
  const setup = secret ? httpLines(secret).join("\n") : null;

  return (
    <div className="space-y-4">
      <ol className="space-y-1.5 text-sm text-foreground">
        <li>
          <span className="num mr-2 text-muted-foreground">1</span>Give your agent the credential as <code className="text-xs">AEGIS_API_KEY</code>.
        </li>
        <li>
          <span className="num mr-2 text-muted-foreground">2</span>Run your agent once.
        </li>
        <li>
          <span className="num mr-2 text-muted-foreground">3</span>Aegis confirms the connection on this page.
        </li>
      </ol>

      {setup && method === "http" && (
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm text-foreground">Add this to your agent and run it once.</p>
          <CopyButton value={setup} label="Copy setup" />
        </div>
      )}

      <div role="tablist" aria-label="Setup" className="inline-flex rounded-md border border-border p-0.5">
        {(
          [
            ["http", "Any language"],
            ["sdk", "Aegis SDK (early access)"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            role="tab"
            type="button"
            aria-selected={method === id}
            onClick={() => setMethod(id)}
            className={cn("focus-ring rounded px-3 py-1 text-xs font-medium", method === id ? "bg-surface-muted text-foreground" : "text-muted-foreground hover:text-foreground")}
          >
            {label}
          </button>
        ))}
      </div>

      {method === "http" ? (
        <div className="space-y-3">
          <CodeBlock language="bash" code={http} />
          <p className="text-xs text-muted-foreground">Works from any language: these are plain HTTPS requests. Nothing to install.</p>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            The TypeScript SDK is not on a public package registry yet, so there is nothing to <code className="text-xs">npm install</code> today. Use the setup under <em>Any language</em>, or ask Aegis for the package. Once you have it, this is the code:
          </p>
          <CodeBlock language="typescript" code={sdk} />
        </div>
      )}
    </div>
  );
}
