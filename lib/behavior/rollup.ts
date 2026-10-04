import "server-only";

import { Prisma } from "@prisma/client";

import { MAX_ROLLUP_HOURS_PER_REFRESH, ROLLUP_RETENTION_DAYS } from "@/lib/behavior/config";

const HOUR_MS = 60 * 60 * 1000;

export function floorToHour(date: Date): Date {
  return new Date(Math.floor(date.getTime() / HOUR_MS) * HOUR_MS);
}

export function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

/**
 * `activity_events.timestamp` is `timestamp without time zone` holding UTC
 * (Prisma's convention). Pass instants as ISO strings cast to `timestamp`
 * (Postgres ignores the trailing "Z" for that type), so comparisons never
 * depend on the database session's or the host's time zone.
 */
export const sqlTimestamp = (date: Date) => Prisma.sql`${date.toISOString()}::timestamp`;

/**
 * Brings agent_activity_rollups up to date for every CLOSED hour, from the
 * agent's rollup watermark (or its first event) up to the start of the
 * current hour. Must run inside a transaction holding the agent's behavior
 * lock (lib/behavior/baseline.ts).
 *
 * Exact, not incremental: each hour range is deleted and recomputed from
 * activity_events in one INSERT … SELECT. Events are bucketed by Aegis's
 * receipt `timestamp`, so a closed hour never gains events afterwards and the
 * recomputation is final. Bounded per call (MAX_ROLLUP_HOURS_PER_REFRESH).
 */
export async function rollUpClosedHours(
  tx: Prisma.TransactionClient,
  params: { organizationId: string; agentId: string; now: Date }
): Promise<{ from: Date; to: Date } | null> {
  const { organizationId, agentId, now } = params;
  const currentHour = floorToHour(now);
  const retentionStart = floorToHour(new Date(now.getTime() - ROLLUP_RETENTION_DAYS * 24 * HOUR_MS));

  const state = await tx.agentBehaviorState.upsert({
    where: { agentId },
    create: { agentId, organizationId },
    update: {},
  });

  let from = state.rollupThrough;
  if (!from) {
    const first = await tx.activityEvent.findFirst({
      where: { agentId, organizationId },
      orderBy: { timestamp: "asc" },
      select: { timestamp: true },
    });
    from = first ? floorToHour(first.timestamp) : currentHour;
  }
  if (from < retentionStart) from = retentionStart;

  // Retention: rollups older than the window that can ever be read again.
  await tx.agentActivityRollup.deleteMany({ where: { agentId, hourStart: { lt: retentionStart } } });

  if (from >= currentHour) {
    if (!state.rollupThrough) await tx.agentBehaviorState.update({ where: { agentId }, data: { rollupThrough: currentHour } });
    return null;
  }
  const to = new Date(Math.min(currentHour.getTime(), from.getTime() + MAX_ROLLUP_HOURS_PER_REFRESH * HOUR_MS));

  await tx.agentActivityRollup.deleteMany({ where: { agentId, hourStart: { gte: from, lt: to } } });

  await tx.$executeRaw`
    INSERT INTO "agent_activity_rollups" ("organizationId", "agentId", "hourStart", "dimension", "key", "count", "recordSum", "byteSum")
    WITH ev AS (
      SELECT e."id", date_trunc('hour', e."timestamp") AS h, e."action", e."eventType"::text AS event_type,
             e."toolKey", e."service", e."destination", e."dataClasses", e."environment"::text AS environment,
             e."endUserHash", e."outcome"::text AS outcome, e."status"::text AS status, e."source",
             e."recordCount", e."byteCount", e."parentEventId"
        FROM "activity_events" e
       WHERE e."agentId" = ${agentId} AND e."organizationId" = ${organizationId}
         AND e."timestamp" >= ${sqlTimestamp(from)} AND e."timestamp" < ${sqlTimestamp(to)}
    ),
    learn AS (SELECT * FROM ev WHERE status NOT IN ('BLOCKED', 'APPROVAL_REQUIRED'))
    SELECT ${organizationId}::text, ${agentId}::text, agg.h, agg.dim, agg.k, agg.c, agg.r, agg.b FROM (
      SELECT h, 'total' AS dim, '' AS k, count(*)::int AS c,
             coalesce(sum("recordCount"), 0)::float8 AS r, coalesce(sum("byteCount"), 0)::float8 AS b
        FROM learn GROUP BY h
      UNION ALL SELECT h, 'action', "action", count(*)::int, 0, 0 FROM learn GROUP BY h, "action"
      UNION ALL SELECT h, 'eventType', event_type, count(*)::int, 0, 0 FROM learn GROUP BY h, event_type
      UNION ALL SELECT h, 'tool', "toolKey", count(*)::int, 0, 0 FROM learn WHERE "toolKey" IS NOT NULL GROUP BY h, "toolKey"
      UNION ALL SELECT h, 'service', "service", count(*)::int, 0, 0 FROM learn WHERE "service" IS NOT NULL GROUP BY h, "service"
      UNION ALL SELECT h, 'destination', "destination", count(*)::int, 0, 0 FROM learn WHERE "destination" IS NOT NULL GROUP BY h, "destination"
      UNION ALL SELECT h, 'dataClass', dc::text, count(*)::int, 0, 0 FROM learn, unnest("dataClasses") AS dc GROUP BY h, dc
      UNION ALL SELECT h, 'environment', environment, count(*)::int, 0, 0 FROM learn WHERE environment IS NOT NULL GROUP BY h, environment
      UNION ALL SELECT h, 'endUser', "endUserHash", count(*)::int, 0, 0 FROM learn WHERE "endUserHash" IS NOT NULL GROUP BY h, "endUserHash"
      UNION ALL SELECT h, 'outcome', outcome, count(*)::int, 0, 0 FROM learn WHERE outcome IS NOT NULL GROUP BY h, outcome
      UNION ALL SELECT h, 'decision', status, count(*)::int, 0, 0 FROM ev WHERE "source" = 'policy_evaluation' GROUP BY h, status
      -- Parent lookup by PRIMARY KEY ONLY (the tenant check is applied to the
      -- returned row). Any extra predicate in the lookup — even inside a
      -- subquery — let the planner pick the (organizationId, …) index under
      -- stale statistics (e.g. right after a bulk insert) and scan the whole
      -- organization once per child: ~10-20s for 6.7k events, vs a single
      -- PK probe per child here.
      UNION ALL SELECT l.h, 'transition', p.parent_action || '>' || l."action", count(*)::int, 0, 0
        FROM learn l
        CROSS JOIN LATERAL (
          SELECT pe."action" AS parent_action, pe."organizationId" AS parent_org
            FROM "activity_events" pe WHERE pe."id" = l."parentEventId"
        ) p
       WHERE l."parentEventId" IS NOT NULL AND p.parent_org = ${organizationId}
       GROUP BY l.h, p.parent_action || '>' || l."action"
    ) agg`;

  await tx.agentBehaviorState.update({ where: { agentId }, data: { rollupThrough: to } });
  return { from, to };
}
