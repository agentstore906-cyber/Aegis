import { describe, expect, it } from "vitest";
import type { IncidentStatus } from "@prisma/client";

import { CLOSED_STATUSES, MAX_NOTE_LENGTH, STATUS_TRANSITIONS, checkTransition } from "@/lib/incidents/status";

const ALL: IncidentStatus[] = ["OPEN", "INVESTIGATING", "RESOLVED", "FALSE_POSITIVE"];

describe("incident status transitions", () => {
  it("allows exactly the documented transitions", () => {
    const allowed: [IncidentStatus, IncidentStatus][] = [
      ["OPEN", "INVESTIGATING"],
      ["OPEN", "RESOLVED"],
      ["OPEN", "FALSE_POSITIVE"],
      ["INVESTIGATING", "OPEN"],
      ["INVESTIGATING", "RESOLVED"],
      ["INVESTIGATING", "FALSE_POSITIVE"],
      ["RESOLVED", "OPEN"],
      ["FALSE_POSITIVE", "OPEN"],
    ];
    for (const from of ALL) {
      for (const to of ALL) {
        if (from === to) continue;
        const isAllowed = allowed.some(([f, t]) => f === from && t === to);
        const result = checkTransition(from, to, "a note");
        expect(result.ok, `${from} -> ${to}`).toBe(isAllowed);
        expect(STATUS_TRANSITIONS[from].includes(to)).toBe(isAllowed);
      }
    }
  });

  it("closed states can only be reopened, and say so", () => {
    for (const from of CLOSED_STATUSES) {
      expect(STATUS_TRANSITIONS[from]).toEqual(["OPEN"]);
    }
    const jump = checkTransition("RESOLVED", "FALSE_POSITIVE", "x");
    expect(jump).toMatchObject({ ok: false, code: "NOT_ALLOWED" });
    expect((jump as { message: string }).message).toContain("reopen it first");
  });

  it("a no-op is rejected, not silently recorded", () => {
    expect(checkTransition("OPEN", "OPEN", "x")).toMatchObject({ ok: false, code: "NO_CHANGE" });
  });

  it("FALSE_POSITIVE requires an explanation; other transitions do not", () => {
    expect(checkTransition("OPEN", "FALSE_POSITIVE", undefined)).toMatchObject({ ok: false, code: "NOTE_REQUIRED" });
    expect(checkTransition("OPEN", "FALSE_POSITIVE", "   ")).toMatchObject({ ok: false, code: "NOTE_REQUIRED" });
    expect(checkTransition("OPEN", "FALSE_POSITIVE", "Scheduled load test")).toEqual({ ok: true });
    expect(checkTransition("OPEN", "RESOLVED", undefined)).toEqual({ ok: true });
    expect(checkTransition("RESOLVED", "OPEN", undefined)).toEqual({ ok: true });
  });

  it("bounds note length", () => {
    expect(checkTransition("OPEN", "RESOLVED", "x".repeat(MAX_NOTE_LENGTH + 1))).toMatchObject({ ok: false, code: "NOTE_TOO_LONG" });
    expect(checkTransition("OPEN", "RESOLVED", "x".repeat(MAX_NOTE_LENGTH))).toEqual({ ok: true });
  });
});
