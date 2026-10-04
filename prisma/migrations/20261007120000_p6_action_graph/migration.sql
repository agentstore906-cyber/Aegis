-- P6 — Agent Action Graph. See docs/AEGIS_P6_ACTION_GRAPH.md.
-- The graph is a read model derived from existing rows; this migration adds
-- no table and no column. It only adds the `graph:read` scope to the default
-- scopes of NEW API keys (existing keys are not changed — to read the graph
-- with an older key, create a new key).

-- AlterTable
ALTER TABLE "api_keys" ALTER COLUMN "scopes" SET DEFAULT ARRAY['events:write', 'policy:evaluate', 'approvals:read', 'behavior:read', 'trust:read', 'graph:read']::TEXT[];
