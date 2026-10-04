-- Remove the Agent Arena feature (docs/AEGIS_AGENT_ARENA_REMOVAL.md).
-- DESTRUCTIVE and irreversible: drops all Arena scorecards, scenario results, challenge attributions and funnel analytics.
-- These tables had no foreign keys to, and no readers outside, the Arena feature (Organization/Agent/User untouched).
-- Dropping the scorecards table also removes its indexes and its self-referencing foreign key.

DROP TABLE IF EXISTS "arena_scenario_results";
DROP TABLE IF EXISTS "arena_challenge_attributions";
DROP TABLE IF EXISTS "arena_analytics_events";
DROP TABLE IF EXISTS "arena_scorecards";
DROP TYPE IF EXISTS "ArenaScorecardStatus";
