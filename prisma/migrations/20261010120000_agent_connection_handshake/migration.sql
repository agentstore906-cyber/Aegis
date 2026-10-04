-- Agent connection handshake. See docs/AEGIS_AGENT_CONNECTION.md.
-- Additive: two nullable columns on agent_connections.
--   firstHandshakeAt  first time a request authenticated with the connection's own agent-bound key reached Aegis
--   lastSeenAt        most recent such request (written at most once a minute)
-- Backfill (evidence only, never invented): a connection whose agent already has reported activity is
-- stamped with the timestamps of that activity, so existing working agents do not regress to "waiting".
-- A connection whose agent never reported anything stays NULL and is shown as waiting for its first contact.

ALTER TABLE "agent_connections" ADD COLUMN "firstHandshakeAt" TIMESTAMP(3);
ALTER TABLE "agent_connections" ADD COLUMN "lastSeenAt" TIMESTAMP(3);

UPDATE "agent_connections" c
   SET "firstHandshakeAt" = e.first_at,
       "lastSeenAt" = e.last_at
  FROM (
    SELECT "agentId", MIN("timestamp") AS first_at, MAX("timestamp") AS last_at
      FROM "activity_events"
     WHERE "source" = 'api'
     GROUP BY "agentId"
  ) e
 WHERE e."agentId" = c."agentId";
