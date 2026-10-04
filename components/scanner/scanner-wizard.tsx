"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, Loader2, ScanSearch } from "lucide-react";

import {
  AGENT_TYPES,
  AGENT_TYPE_IDS,
  AUTONOMY_IDS,
  AUTONOMY_LEVELS,
  CAPABILITIES,
  CAPABILITY_GROUPS,
  CAPABILITY_IDS,
  CONTROLS,
  CONTROL_IDS,
  CONTROL_STATES,
  CONTROL_STATE_LABEL,
  LIMITS,
  type ControlId,
  type ControlState,
} from "@/lib/scanner/catalog";
import {
  STEPS,
  draftForStorage,
  emptyDraft,
  relevantControls,
  stepForField,
  stepProblem,
  suggestedCapabilities,
  toRequestBody,
  toggleAutonomy,
  toggleIn,
  type Draft,
  type StepId,
} from "@/lib/scanner/wizard-model";
import { sendScannerEvent } from "@/components/scanner/track";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/field";
import { cn } from "@/lib/utils";

const STORAGE_KEY = "aegis_scan_draft_v1";
const REQUEST_TIMEOUT_MS = 20_000;

const STEP_COPY: Record<StepId, { title: string; help: string }> = {
  type: { title: "What kind of AI agent are you securing?", help: "Pick the closest match. This only shapes the questions that follow." },
  capabilities: { title: "What can your agent access?", help: "Select everything it can reach today, even occasionally. Skip a group if none apply." },
  autonomy: { title: "What can your agent do without human approval?", help: "Select every level that applies to some of its actions." },
  controls: { title: "Which security controls are in place today?", help: "Answer what you know. “Not sure” is a fair answer — it simply earns less credit." },
  advanced: { title: "Optional: add something to analyze", help: "Add a configuration, system prompt, tool definitions or a sample log for extra signals. Skip this if you like." },
};

type Failure = { kind: "invalid" | "rate_limited" | "timeout" | "server" | "network"; message: string };

function restore(): { draft: Draft; step: number } | null {
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as Partial<ReturnType<typeof draftForStorage>>;
    if (v.v !== 1) return null;
    const draft = emptyDraft();
    if (typeof v.agentType === "string" && (AGENT_TYPE_IDS as string[]).includes(v.agentType)) draft.agentType = v.agentType as Draft["agentType"];
    if (typeof v.agentLabel === "string") draft.agentLabel = v.agentLabel.slice(0, LIMITS.maxAgentLabelChars);
    if (Array.isArray(v.capabilities)) draft.capabilities = v.capabilities.filter((c): c is Draft["capabilities"][number] => (CAPABILITY_IDS as string[]).includes(c));
    if (Array.isArray(v.autonomy)) draft.autonomy = v.autonomy.filter((a): a is Draft["autonomy"][number] => (AUTONOMY_IDS as string[]).includes(a));
    if (v.controls && typeof v.controls === "object") {
      for (const [k, s] of Object.entries(v.controls)) {
        if ((CONTROL_IDS as string[]).includes(k) && (CONTROL_STATES as readonly string[]).includes(s as string)) draft.controls[k as ControlId] = s as ControlState;
      }
    }
    const step = typeof v.step === "number" ? Math.min(Math.max(0, Math.trunc(v.step)), STEPS.length - 1) : 0;
    return { draft, step: draft.agentType ? step : 0 };
  } catch {
    return null;
  }
}

export function ScannerWizard() {
  const router = useRouter();
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [step, setStep] = useState(0);
  const [problem, setProblem] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [resumed, setResumed] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const started = useRef(false);
  const hydrated = useRef(false);

  const stepId = STEPS[step]!;

  // Restore progress after a refresh (never the pasted text) and report the page view once.
  useEffect(() => {
    const saved = restore();
    if (saved && (saved.draft.agentType || saved.step > 0)) {
      // Synchronising React state from an external system (sessionStorage) after hydration — it can't be read during SSR.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setDraft(saved.draft);
      setStep(saved.step);
      setResumed(true);
    }
    hydrated.current = true;
    sendScannerEvent("scanner_viewed");
  }, []);

  useEffect(() => {
    if (!hydrated.current) return;
    try {
      window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(draftForStorage(draft, step)));
    } catch {
      // Storage can be unavailable (private mode); the wizard works without it.
    }
  }, [draft, step]);

  useEffect(() => {
    headingRef.current?.focus({ preventScroll: false });
  }, [step]);

  const update = useCallback((patch: Partial<Draft>) => {
    setDraft((d) => ({ ...d, ...patch }));
    setProblem(null);
    setFailure(null);
    if (!started.current) {
      started.current = true;
      sendScannerEvent("scanner_started");
    }
  }, []);

  function next() {
    const issue = stepProblem(stepId, draft);
    if (issue) return setProblem(issue);
    sendScannerEvent("scanner_step_completed", { step: step + 1 });
    setProblem(null);
    setStep((s) => Math.min(STEPS.length - 1, s + 1));
  }

  function back() {
    setProblem(null);
    setFailure(null);
    setStep((s) => Math.max(0, s - 1));
  }

  async function submit() {
    const issue = stepProblem("advanced", draft) ?? stepProblem("type", draft) ?? stepProblem("autonomy", draft);
    if (issue) return setProblem(issue);

    setSubmitting(true);
    setFailure(null);
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const res = await fetch("/api/scan", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(toRequestBody(draft)),
        signal: controller.signal,
      });
      if (res.status === 201) {
        const data = (await res.json()) as { id: string; reportUrl: string; level: string; score: number };
        sendScannerEvent("scanner_completed", { level: data.level, score: data.score }, data.id);
        try {
          window.sessionStorage.removeItem(STORAGE_KEY);
        } catch {
          // ignore
        }
        // reportUrl is server-generated; only follow same-site relative paths.
        router.push(data.reportUrl.startsWith("/") && !data.reportUrl.startsWith("//") ? data.reportUrl : `/scan/report/${encodeURIComponent(data.id)}`);
        return;
      }
      const body = (await res.json().catch(() => null)) as { error?: { message?: string; fields?: Record<string, string> } } | null;
      if (res.status === 422 && body?.error?.fields) {
        const [field, message] = Object.entries(body.error.fields)[0] ?? ["", "Please check your answers."];
        setStep(STEPS.indexOf(stepForField(field)));
        setProblem(message);
        setFailure({ kind: "invalid", message: "Some answers need another look." });
      } else if (res.status === 429) {
        setFailure({ kind: "rate_limited", message: body?.error?.message ?? "You’ve run a lot of scans recently. Please try again a little later." });
      } else if (res.status === 413) {
        setStep(STEPS.indexOf("advanced"));
        setProblem("What you pasted is too large. Shorten it and try again.");
        setFailure({ kind: "invalid", message: "Too large." });
      } else {
        setFailure({ kind: "server", message: body?.error?.message ?? "We couldn’t complete the scan. Your answers are still here — please try again." });
      }
    } catch (error) {
      const aborted = error instanceof DOMException && error.name === "AbortError";
      setFailure(
        aborted
          ? { kind: "timeout", message: "The scan is taking longer than expected. Your answers are saved here — please try again." }
          : { kind: "network", message: "We couldn’t reach Aegis. Check your connection and try again — your answers are still here." }
      );
    } finally {
      window.clearTimeout(timer);
      setSubmitting(false);
    }
  }

  const copy = STEP_COPY[stepId];
  const isLast = step === STEPS.length - 1;

  return (
    <div className="mx-auto w-full max-w-2xl">
      <div className="mb-6" aria-live="polite">
        <div className="mb-2 flex items-center justify-between text-xs text-muted-foreground">
          <span>
            Step {step + 1} of {STEPS.length}
          </span>
          <span>About a minute</span>
        </div>
        <div className="h-1 overflow-hidden rounded-full bg-surface-muted" role="progressbar" aria-valuemin={1} aria-valuemax={STEPS.length} aria-valuenow={step + 1} aria-label="Scan progress">
          <div className="h-full rounded-full bg-foreground transition-[width] duration-200" style={{ width: `${((step + 1) / STEPS.length) * 100}%` }} />
        </div>
      </div>

      {resumed && step > 0 && <p className="mb-4 text-xs text-muted-foreground">Picked up where you left off. Pasted text is never saved in your browser.</p>}

      <section aria-labelledby="scan-step-title" className="rounded-xl border border-border bg-surface p-5 sm:p-7">
        <h2 id="scan-step-title" ref={headingRef} tabIndex={-1} className="text-xl font-semibold tracking-tight text-foreground outline-none">
          {copy.title}
        </h2>
        <p className="mt-1.5 text-sm text-muted-foreground">{copy.help}</p>

        <div className="mt-6">
          {stepId === "type" && <TypeStep draft={draft} update={update} />}
          {stepId === "capabilities" && <CapabilitiesStep draft={draft} update={update} />}
          {stepId === "autonomy" && <AutonomyStep draft={draft} update={update} />}
          {stepId === "controls" && <ControlsStep draft={draft} update={update} />}
          {stepId === "advanced" && <AdvancedStep draft={draft} update={update} />}
        </div>

        {problem && (
          <p role="alert" className="mt-4 text-sm text-danger">
            {problem}
          </p>
        )}
        {failure && failure.kind !== "invalid" && (
          <div className="mt-4">
            <Alert tone={failure.kind === "rate_limited" ? "warning" : "danger"}>{failure.message}</Alert>
          </div>
        )}

        <div className="mt-7 flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
          {step > 0 ? (
            <Button type="button" variant="ghost" onClick={back} disabled={submitting}>
              <ArrowLeft className="size-4" aria-hidden="true" />
              Back
            </Button>
          ) : (
            <span />
          )}
          {isLast ? (
            <Button type="button" size="lg" onClick={submit} disabled={submitting}>
              {submitting ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <ScanSearch className="size-4" aria-hidden="true" />}
              {submitting ? "Scanning…" : failure ? "Try again" : "Run the scan"}
            </Button>
          ) : (
            <Button type="button" size="lg" onClick={next}>
              Continue
              <ArrowRight className="size-4" aria-hidden="true" />
            </Button>
          )}
        </div>
      </section>

      <p className="mt-4 text-center text-xs text-muted-foreground">No account needed. The scanner only analyzes what you describe — it never runs or contacts your agent.</p>
    </div>
  );
}

type StepProps = { draft: Draft; update: (patch: Partial<Draft>) => void };

/** A selectable card: a real checkbox/radio (keyboard + screen-reader native) styled by its checked state. */
function Choice({ type, name, checked, onChange, title, hint, badge }: { type: "checkbox" | "radio"; name?: string; checked: boolean; onChange: () => void; title: string; hint?: string; badge?: string }) {
  return (
    <label
      className={cn(
        "relative flex min-h-14 cursor-pointer items-start gap-3 rounded-lg border p-3.5 text-left transition-colors",
        "has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-brand has-[:focus-visible]:ring-offset-2 has-[:focus-visible]:ring-offset-background",
        checked ? "border-foreground bg-surface-muted" : "border-border hover:border-border-strong hover:bg-surface-muted"
      )}
    >
      <input type={type} name={name} checked={checked} onChange={onChange} className="peer sr-only" />
      <span
        aria-hidden="true"
        className={cn("mt-0.5 flex size-4 shrink-0 items-center justify-center border", type === "radio" ? "rounded-full" : "rounded-[4px]", checked ? "border-foreground bg-foreground" : "border-border-strong bg-surface")}
      >
        {checked && <span className={cn("bg-background", type === "radio" ? "size-1.5 rounded-full" : "size-2 rounded-[2px]")} />}
      </span>
      <span className="min-w-0">
        <span className="flex flex-wrap items-center gap-x-2 text-sm font-medium text-foreground">
          {title}
          {badge && <span className="rounded-sm bg-brand/10 px-1.5 py-0.5 text-[11px] font-medium text-brand">{badge}</span>}
        </span>
        {hint && <span className="mt-0.5 block text-xs text-muted-foreground">{hint}</span>}
      </span>
    </label>
  );
}

function TypeStep({ draft, update }: StepProps) {
  return (
    <fieldset>
      <legend className="sr-only">Agent type</legend>
      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
        {AGENT_TYPES.map((t) => (
          <Choice key={t.id} type="radio" name="agentType" checked={draft.agentType === t.id} onChange={() => update({ agentType: t.id })} title={t.label} hint={t.hint} />
        ))}
      </div>
      {draft.agentType === "other" && (
        <div className="mt-4">
          <label htmlFor="agent-label" className="mb-1.5 block text-sm font-medium text-foreground">
            Describe your agent
          </label>
          <Input id="agent-label" value={draft.agentLabel} maxLength={LIMITS.maxAgentLabelChars} onChange={(e) => update({ agentLabel: e.target.value })} placeholder="e.g. Procurement assistant" autoComplete="off" />
        </div>
      )}
    </fieldset>
  );
}

function CapabilitiesStep({ draft, update }: StepProps) {
  const suggested = suggestedCapabilities(draft.agentType);
  return (
    <div className="space-y-6">
      {CAPABILITY_GROUPS.map((group) => (
        <fieldset key={group.id}>
          <legend className="mb-2 text-sm font-semibold text-foreground">
            {group.label} <span className="font-normal text-muted-foreground">— {group.question}</span>
          </legend>
          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
            {CAPABILITIES.filter((c) => c.group === group.id).map((c) => (
              <Choice
                key={c.id}
                type="checkbox"
                checked={draft.capabilities.includes(c.id)}
                onChange={() => update({ capabilities: toggleIn(draft.capabilities, c.id) })}
                title={c.label}
                hint={c.hint}
                badge={suggested.includes(c.id) ? "Common for this agent" : undefined}
              />
            ))}
          </div>
        </fieldset>
      ))}
    </div>
  );
}

function AutonomyStep({ draft, update }: StepProps) {
  const noActions = !draft.capabilities.some((id) => CAPABILITIES.find((c) => c.id === id)?.group === "actions" || id === "code_execution" || id === "shell");
  return (
    <fieldset>
      <legend className="sr-only">Autonomy</legend>
      {noActions && <p className="mb-3 text-xs text-muted-foreground">You didn’t select any actions or code execution, so this mostly describes how it uses its tools and data.</p>}
      <div className="grid grid-cols-1 gap-2.5">
        {AUTONOMY_LEVELS.map((a) => (
          <Choice key={a.id} type="checkbox" checked={draft.autonomy.includes(a.id)} onChange={() => update({ autonomy: toggleAutonomy(draft.autonomy, a.id) })} title={a.label} hint={a.hint} />
        ))}
      </div>
    </fieldset>
  );
}

function ControlsStep({ draft, update }: StepProps) {
  const relevant = relevantControls(draft);
  const ordered = [...CONTROLS].sort((a, b) => Number(relevant.includes(b.id)) - Number(relevant.includes(a.id)));
  return (
    <div className="divide-y divide-border rounded-lg border border-border">
      {ordered.map((c) => {
        const value = draft.controls[c.id];
        return (
          <fieldset key={c.id} className="p-3.5">
            <legend className="sr-only">{c.label}</legend>
            <div className="flex flex-wrap items-center gap-x-2">
              <p className="text-sm font-medium text-foreground">{c.label}</p>
              {relevant.includes(c.id) && <span className="rounded-sm bg-brand/10 px-1.5 py-0.5 text-[11px] font-medium text-brand">Relevant to your agent</span>}
            </div>
            <p className="mt-0.5 text-xs text-muted-foreground">{c.hint}</p>
            <div className="mt-2.5 grid grid-cols-2 gap-1.5 sm:grid-cols-4" role="radiogroup" aria-label={c.label}>
              {CONTROL_STATES.map((state) => (
                <label
                  key={state}
                  className={cn(
                    "flex h-9 cursor-pointer items-center justify-center rounded-md border px-2 text-xs font-medium transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-brand",
                    value === state ? "border-foreground bg-foreground text-background" : "border-border text-foreground hover:bg-surface-muted"
                  )}
                >
                  <input type="radio" name={`control-${c.id}`} className="sr-only" checked={value === state} onChange={() => update({ controls: { ...draft.controls, [c.id]: state } })} />
                  {CONTROL_STATE_LABEL[state]}
                </label>
              ))}
            </div>
          </fieldset>
        );
      })}
    </div>
  );
}

function AdvancedStep({ draft, update }: StepProps) {
  const over = draft.advancedText.length > LIMITS.maxAdvancedChars;
  return (
    <div>
      <label htmlFor="advanced-text" className="mb-1.5 block text-sm font-medium text-foreground">
        Configuration, system prompt, tool definitions, MCP config or sample log
      </label>
      <Textarea
        id="advanced-text"
        rows={9}
        value={draft.advancedText}
        onChange={(e) => update({ advancedText: e.target.value })}
        spellCheck={false}
        autoComplete="off"
        className="font-mono text-xs"
        placeholder="Optional. Paste text here to look for extra signals."
        aria-describedby="advanced-help"
      />
      <div id="advanced-help" className="mt-2 flex flex-wrap items-start justify-between gap-2 text-xs text-muted-foreground">
        <p className="max-w-md">
          Treated as untrusted text: scanned in memory for risk signals, never executed, and never stored. Please don’t paste live credentials — if you do, we only report that something looked like a secret.
        </p>
        <p className={cn("tabular-nums", over && "text-danger")}>
          {draft.advancedText.length.toLocaleString("en-US")} / {LIMITS.maxAdvancedChars.toLocaleString("en-US")}
        </p>
      </div>
    </div>
  );
}
