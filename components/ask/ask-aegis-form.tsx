"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { Sparkles, ArrowRight } from "lucide-react";
import { Textarea } from "@/components/ui/field";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { Card, CardContent } from "@/components/ui/card";
import { askAegisAction, type AskAegisState } from "@/lib/ask/actions";
import { ASK_AEGIS_EXAMPLE_QUESTIONS } from "@/lib/ask/examples";
import { formatDateTime } from "@/lib/utils";

const initialState: AskAegisState = {};

export function AskAegisForm() {
  const [state, formAction, pending] = useActionState(askAegisAction, initialState);
  const [question, setQuestion] = useState(state.question ?? "");

  return (
    <div className="space-y-6">
      <form action={formAction} className="space-y-3" noValidate>
        <Textarea
          name="question"
          rows={2}
          maxLength={300}
          placeholder="Which actions were blocked this week?"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
        />
        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" disabled={pending}>
            <Sparkles className="size-4" aria-hidden="true" />
            {pending ? "Checking evidence…" : "Ask"}
          </Button>
          <span className="text-xs text-muted-foreground">
            Answers are computed from your organization&rsquo;s actual Aegis data — never generated freely.
          </span>
        </div>
        {state.error && <Alert tone="danger">{state.error}</Alert>}
      </form>

      {state.answer ? (
        <Card>
          <CardContent className="space-y-4">
            <p className="text-sm text-foreground">{state.answer.summary}</p>

            {state.answer.evidence.length > 0 && (
              <div className="border-t border-border pt-4">
                <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Evidence</p>
                <ul className="space-y-2">
                  {state.answer.evidence.map((item, i) => (
                    <li key={`${item.href}-${i}`}>
                      <Link
                        href={item.href}
                        className="focus-ring flex items-center justify-between gap-3 rounded-sm text-sm text-foreground hover:underline"
                      >
                        <span className="min-w-0 truncate">
                          {item.label}
                          {item.detail && <span className="ml-1.5 text-muted-foreground">— {item.detail}</span>}
                        </span>
                        <span className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
                          {item.timestamp && formatDateTime(item.timestamp)}
                          <ArrowRight className="size-3" aria-hidden="true" />
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </CardContent>
        </Card>
      ) : (
        <div>
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Try asking</p>
          <div className="flex flex-wrap gap-2">
            {ASK_AEGIS_EXAMPLE_QUESTIONS.map((q) => (
              <button
                key={q}
                type="button"
                className="focus-ring rounded-full border border-border bg-surface px-3 py-1.5 text-xs text-foreground hover:bg-surface-muted"
                onClick={() => setQuestion(q)}
              >
                {q}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
