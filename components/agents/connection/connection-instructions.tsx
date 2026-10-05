"use client";

import { useEffect, useState } from "react";

import { CodeBlock } from "@/components/ui/code-block";
import { CopyButton } from "@/components/ui/copy-button";
import { cn } from "@/lib/utils";

type Method = "sdk" | "http";

/**
 * The minimum an agent needs to say hello. The credential is referenced as an environment variable — it is not
 * pasted into the snippets — and the base URL is this deployment's own origin, read in the browser.
 */
export function ConnectionInstructions({ secret }: { secret?: string }) {
  const [origin, setOrigin] = useState("https://YOUR-AEGIS-URL");
  const [method, setMethod] = useState<Method>("sdk");
  useEffect(() => {
    const t = setTimeout(() => setOrigin(window.location.origin), 0);
    return () => clearTimeout(t);
  }, []);

  const sdk = [
    'import { Aegis } from "@aegis/agent-sdk";',
    "",
    "const aegis = new Aegis({",
    "  apiKey: process.env.AEGIS_API_KEY!,",
    `  baseUrl: "${origin}",`,
    "});",
    "",
    "// Call once when your agent starts. Safe to repeat. Your key already says which agent this is.",
    "await aegis.handshake();",
  ].join("\n");
  // "Copy setup": everything the agent needs, ready to paste, with the real credential in it. Built only from what
  // is already on this screen and copied only when the user asks.
  const setup = secret
    ? method === "sdk"
      ? [`export AEGIS_API_KEY="${secret}"`, "npm install @aegis/agent-sdk", "", sdk].join("\n")
      : [`export AEGIS_API_KEY="${secret}"`, `curl -X POST ${origin}/api/v1/connect/handshake \\`, '  -H "Authorization: Bearer $AEGIS_API_KEY"'].join("\n")
    : null;
  const http = [`curl -X POST ${origin}/api/v1/connect/handshake \\`, '  -H "Authorization: Bearer $AEGIS_API_KEY"'].join("\n");

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
          <span className="num mr-2 text-muted-foreground">3</span>Aegis verifies the connection on this page.
        </li>
      </ol>

      {setup && (
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm text-foreground">Add this to your agent and run it once.</p>
          <CopyButton value={setup} label="Copy setup" />
        </div>
      )}

      <div role="tablist" aria-label="Connection method" className="inline-flex rounded-md border border-border p-0.5">
        {(
          [
            ["sdk", "Aegis SDK"],
            ["http", "HTTP"],
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

      {method === "sdk" ? (
        <div className="space-y-3">
          <CodeBlock language="bash" code={`npm install @aegis/agent-sdk\nexport AEGIS_API_KEY="<your credential>"`} />
          <CodeBlock language="typescript" code={sdk} />
        </div>
      ) : (
        <div className="space-y-3">
          <CodeBlock language="bash" code={`export AEGIS_API_KEY="<your credential>"\n${http}`} />
          <p className="text-xs text-muted-foreground">Any language works: the handshake is one authenticated POST.</p>
        </div>
      )}
    </div>
  );
}
