\set ON_ERROR_STOP on
\timing off
BEGIN;
-- Everything below is rolled back at the end: nothing persists.
INSERT INTO organizations (id,name,slug,"updatedAt") VALUES ('bench_org','bench','bench-slug-x',now());
INSERT INTO agents (id,"organizationId",name,slug,owner,"modelProvider","modelName","updatedAt") VALUES ('bench_agent','bench_org','b','bench-agent-x','o','p','m',now());
-- 90 days x 24 hours x 200 distinct actions (dimension=action) + 20 tools => ~475k rows for ONE agent.
INSERT INTO agent_activity_rollups ("organizationId","agentId","hourStart",dimension,key,count)
SELECT 'bench_org','bench_agent', date_trunc('hour', now()) - (h || ' hours')::interval, 'action', 'ns' || (a % 20) || '.act' || a, 1
  FROM generate_series(0, 90*24-1) h, generate_series(0, 199) a;
INSERT INTO agent_activity_rollups ("organizationId","agentId","hourStart",dimension,key,count)
SELECT 'bench_org','bench_agent', date_trunc('hour', now()) - (h || ' hours')::interval, 'tool', 'tool' || t, 1
  FROM generate_series(0, 90*24-1) h, generate_series(0, 19) t;
ANALYZE agent_activity_rollups;
SELECT count(*) AS rollup_rows FROM agent_activity_rollups WHERE "agentId"='bench_agent';

\echo === A. exact action NOT seen (first-time action: the alerting case) ===
EXPLAIN (ANALYZE, BUFFERS, COSTS OFF, TIMING OFF) SELECT "agentId" FROM agent_activity_rollups WHERE "organizationId"='bench_org' AND "agentId"='bench_agent' AND dimension='action' AND key='brand.new' LIMIT 1;
\echo === B. namespace prefix NOT seen (startsWith) ===
EXPLAIN (ANALYZE, BUFFERS, COSTS OFF, TIMING OFF) SELECT "agentId" FROM agent_activity_rollups WHERE "organizationId"='bench_org' AND "agentId"='bench_agent' AND dimension='action' AND key LIKE 'zzz.%' LIMIT 1;
\echo === C. exact action seen (common case) ===
EXPLAIN (ANALYZE, BUFFERS, COSTS OFF, TIMING OFF) SELECT "agentId" FROM agent_activity_rollups WHERE "organizationId"='bench_org' AND "agentId"='bench_agent' AND dimension='action' AND key='ns3.act3' LIMIT 1;
\echo === D. tool NOT seen ===
EXPLAIN (ANALYZE, BUFFERS, COSTS OFF, TIMING OFF) SELECT "agentId" FROM agent_activity_rollups WHERE "organizationId"='bench_org' AND "agentId"='bench_agent' AND dimension='tool' AND key='newtool' LIMIT 1;

\echo === Candidate index (agentId, dimension, key) created INSIDE this transaction ===
CREATE INDEX bench_candidate ON agent_activity_rollups ("agentId", dimension, key);
ANALYZE agent_activity_rollups;
\echo === A'. exact action NOT seen ===
EXPLAIN (ANALYZE, BUFFERS, COSTS OFF, TIMING OFF) SELECT "agentId" FROM agent_activity_rollups WHERE "organizationId"='bench_org' AND "agentId"='bench_agent' AND dimension='action' AND key='brand.new' LIMIT 1;
\echo === B'. namespace prefix NOT seen (text_pattern_ops would be needed for LIKE under non-C collation) ===
EXPLAIN (ANALYZE, BUFFERS, COSTS OFF, TIMING OFF) SELECT "agentId" FROM agent_activity_rollups WHERE "organizationId"='bench_org' AND "agentId"='bench_agent' AND dimension='action' AND key LIKE 'zzz.%' LIMIT 1;
ROLLBACK;
SELECT count(*) AS leftover_bench_rows FROM agent_activity_rollups WHERE "agentId"='bench_agent';
SHOW lc_collate;
