"use client";

import { useActionState, useState, useTransition } from "react";
import { Check, Copy, Globe, Loader2, Lock, Share2 } from "lucide-react";

import {
  makeScorecardPrivateAction,
  makeScorecardPublicAction,
  recordArenaShareAction,
  type PublishState,
} from "@/lib/arena/actions";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { Label, Input, FieldHint } from "@/components/ui/field";

const initialState: PublishState = {};

export function SharePanel({
  scorecardId,
  isPublic,
  publicUrl,
  shareText,
  defaultDisplayName,
}: {
  scorecardId: string;
  isPublic: boolean;
  publicUrl: string | null;
  shareText: string;
  defaultDisplayName: string;
}) {
  const publishAction = makeScorecardPublicAction.bind(null, scorecardId);
  const [state, formAction, pending] = useActionState(publishAction, initialState);
  const [isPrivating, startPrivate] = useTransition();
  const [copied, setCopied] = useState(false);

  async function copyLink() {
    if (!publicUrl) return;
    await navigator.clipboard.writeText(publicUrl);
    setCopied(true);
    void recordArenaShareAction(scorecardId);
    setTimeout(() => setCopied(false), 2000);
  }

  async function nativeShare() {
    if (!publicUrl) return;
    void recordArenaShareAction(scorecardId);
    const canNativeShare =
      typeof navigator !== "undefined" && typeof navigator.share === "function";
    if (canNativeShare) {
      try {
        await navigator.share({ title: "Aegis Agent Arena", text: shareText, url: publicUrl });
      } catch {
        /* user dismissed */
      }
      return;
    }
    await navigator.clipboard.writeText(`${shareText} ${publicUrl}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  if (!isPublic || !publicUrl) {
    return (
      <form action={formAction} className="space-y-3">
        <p className="text-sm text-muted-foreground">
          This scorecard is <span className="font-medium text-foreground">private</span>. Publishing
          creates a shareable page with the score and category breakdown only — never your agent
          name, model, policies, or activity.
        </p>
        {state.error && <Alert tone="danger">{state.error}</Alert>}
        <div>
          <Label htmlFor="displayName">Public label</Label>
          <Input
            id="displayName"
            name="displayName"
            maxLength={40}
            defaultValue={defaultDisplayName}
            placeholder="Anonymous Agent"
          />
          <FieldHint>Shown on the public page instead of your agent&rsquo;s real name.</FieldHint>
        </div>
        <Button type="submit" disabled={pending}>
          {pending ? (
            <>
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              Publishing…
            </>
          ) : (
            <>
              <Globe className="size-4" aria-hidden="true" />
              Make Scorecard Public
            </>
          )}
        </Button>
      </form>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-sm text-success">
        <Globe className="size-4" aria-hidden="true" />
        <span>Public — anyone with the link can view and challenge this score.</span>
      </div>
      <div className="flex items-center gap-2 rounded-md border border-border bg-surface-muted px-3 py-2">
        <span className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground">
          {publicUrl}
        </span>
        <Button type="button" variant="secondary" size="sm" onClick={copyLink}>
          {copied ? (
            <>
              <Check className="size-3.5" aria-hidden="true" /> Copied
            </>
          ) : (
            <>
              <Copy className="size-3.5" aria-hidden="true" /> Copy Link
            </>
          )}
        </Button>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" size="sm" onClick={nativeShare}>
          <Share2 className="size-3.5" aria-hidden="true" />
          Share Score
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={isPrivating}
          onClick={() => startPrivate(() => makeScorecardPrivateAction(scorecardId))}
        >
          <Lock className="size-3.5" aria-hidden="true" />
          Make Private
        </Button>
      </div>
    </div>
  );
}
