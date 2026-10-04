"use client";

import { useState } from "react";
import { Check, Copy, Link2, Loader2, Share2 } from "lucide-react";

import { shareText, shareTitle } from "@/lib/scanner/share";
import { sendScannerEvent } from "@/components/scanner/track";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

type Props = { scanId: string; score: number; highRisk: number; initialPath: string | null };

/**
 * Sharing is opt-in and reversible. Publishing creates a public page that shows only the score,
 * level, finding titles and one recommendation each — never answers, evidence, labels or pasted text.
 */
export function SharePanel({ scanId, score, highRisk, initialPath }: Props) {
  const [path, setPath] = useState<string | null>(initialPath);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const url = path ? `${window.location.origin}${path}` : null;

  async function setPublic(next: boolean) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/scan/${encodeURIComponent(scanId)}/share`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ public: next }),
      });
      if (!res.ok) {
        setError(res.status === 429 ? "Too many requests. Please try again shortly." : "We couldn’t update sharing for this report. Please try again.");
        return;
      }
      const data = (await res.json()) as { path: string | null };
      setPath(data.path);
    } catch {
      setError("We couldn’t reach Aegis. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      sendScannerEvent("report_shared", { channel: "copy" }, scanId);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("Couldn’t copy automatically. Select the link and copy it.");
    }
  }

  const text = shareText({ high: highRisk }, score);

  return (
    <section aria-labelledby="share-title" className="rounded-xl border border-border bg-surface p-5 sm:p-6">
      <h2 id="share-title" className="flex items-center gap-2 text-lg font-semibold text-foreground">
        <Share2 className="size-4" aria-hidden="true" />
        Share your AI agent security score
      </h2>
      <p className="mt-1.5 text-sm text-muted-foreground">
        “{shareTitle(score)}”. Sharing is optional. The public page shows only your score, risk level, finding titles and recommendations — never your answers, evidence, pasted content or agent details.
      </p>

      {error && (
        <div className="mt-3">
          <Alert tone="danger">{error}</Alert>
        </div>
      )}

      {!path ? (
        <Button type="button" variant="secondary" className="mt-4" onClick={() => setPublic(true)} disabled={busy}>
          {busy ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Link2 className="size-4" aria-hidden="true" />}
          Create a public link
        </Button>
      ) : (
        <div className="mt-4 space-y-3">
          <div className="flex flex-col gap-2 sm:flex-row">
            <input readOnly value={url ?? ""} aria-label="Public report link" onFocus={(e) => e.currentTarget.select()} className="h-9 min-w-0 flex-1 rounded-md border border-border bg-surface-muted px-3 text-xs text-foreground" />
            <Button type="button" variant="secondary" onClick={copy}>
              {copied ? <Check className="size-4" aria-hidden="true" /> : <Copy className="size-4" aria-hidden="true" />}
              {copied ? "Copied" : "Copy link"}
            </Button>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <a
              className="focus-ring rounded-md border border-border px-3 py-1.5 text-foreground hover:bg-surface-muted"
              href={`https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url ?? "")}`}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => sendScannerEvent("report_shared", { channel: "x" }, scanId)}
            >
              Share on X
            </a>
            <a
              className="focus-ring rounded-md border border-border px-3 py-1.5 text-foreground hover:bg-surface-muted"
              href={`https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(url ?? "")}`}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => sendScannerEvent("report_shared", { channel: "linkedin" }, scanId)}
            >
              Share on LinkedIn
            </a>
            <Button type="button" variant="ghost" size="sm" onClick={() => setPublic(false)} disabled={busy}>
              Stop sharing
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}
