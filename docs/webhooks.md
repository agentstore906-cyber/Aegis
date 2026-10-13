# Webhooks (Phase 5)

`lib/webhooks/` — outbound event delivery to `WebhookEndpoint`s created
from `/integrations`. The one integration Aegis ships (spec §25's "choose
one simple high-value integration" — generic outbound webhook), rather
than bespoke Slack/Teams/PagerDuty/Datadog connectors.

## Events

`security.alert.created`, `security.alert.resolved`, `approval.requested`,
`approval.approved`, `approval.rejected`, `cost.anomaly.detected`,
`agent.paused` (`lib/webhooks/dispatch.ts#WEBHOOK_EVENT_TYPES`). Every
payload has a stable envelope:

```json
{ "event": "security.alert.created", "apiVersion": "2026-08-12", "createdAt": "...", "data": { ... } }
```

`apiVersion` is a plain date string on the envelope, not a schema
registry — bump it if the envelope shape ever changes incompatibly (spec
§27's "keep the event schema versioned").

## Security

- **SSRF protection** (`lib/webhooks/ssrf.ts#resolveSafeWebhookTarget`, delivery in `lib/webhooks/safe-post.ts`):
  HTTPS required (an explicit `localhost`/`127.0.0.1`/`::1` carve-out
  exists outside production, for local testing); no `user:pass@` in the URL;
  EVERY address the hostname resolves to must be public — loopback, RFC 1918
  private ranges, link-local (including the 169.254.169.254 metadata
  address), CGNAT, documentation/benchmarking, multicast and reserved
  ranges, and, for IPv6, unique-local, link-local, site-local, multicast and
  every IPv4-embedding form (IPv4-mapped, NAT64, 6to4, Teredo). Checked at
  endpoint-creation time and again before **every delivery attempt**. The
  connection is then made to the address that was checked (no second DNS
  lookup, so DNS rebinding cannot swap in an internal address), **redirects
  are never followed** (a 3xx is recorded as a failed delivery), and each
  attempt has one overall 5 s deadline and a capped, discarded response body.
- **Plan eligibility at delivery time** (`lib/webhooks/dispatch.ts#webhooksEntitled`): endpoints can only be created on a
  plan with webhooks (Startup and above), and delivery re-checks the organization's *current* plan before the first
  attempt and before every retry. A downgraded organization's endpoints stay stored (and can be deleted) but receive
  nothing; an unknown plan, a missing organization or a failed lookup also means "do not deliver". Skips are logged
  as `webhook_delivery_skipped_plan` / `webhook_retry_skipped_plan` (ids only).
- **Signing**: each endpoint gets a random `whsec_...` secret at creation
  (shown once, like an API key — `lib/webhooks/crypto.ts`). Every delivery
  is HMAC-SHA256-signed over the exact raw JSON body and sent as
  `X-Aegis-Signature`; verify by recomputing the HMAC over the raw request
  body with your endpoint's secret and comparing.
- **The secret is never returned by `listWebhookEndpoints()`** — that
  function's Prisma `select` structurally excludes the `secret` column, so
  the dashboard list view can't leak it even by accident (not just "the
  UI happens not to render it" — see
  `lib/webhooks/__tests__/dispatch.integration.test.ts`).
- **Redaction**: payload `data` is passed through
  `lib/security/redact.ts#redactSecrets()` before signing/sending, masking
  any key that looks like a credential.

## Delivery — best-effort, not a durable queue

`dispatchWebhookEvent()` snapshots the (redacted) payload synchronously and
delivers it **after the response is sent** (P0 — `lib/server/defer.ts`,
Next.js `after()`), so a slow or failing receiver can never delay or fail
the request that triggered it (previously up to ~16s on
`POST /api/v1/evaluate`). Delivery makes up to 2 bounded retries (3
attempts total) on network error or 5xx, with a short backoff between
attempts. A 4xx response is never retried — it's the receiver's
problem, not a transient failure. Every attempt (success or failure) is
logged to `WebhookDelivery`, one row per attempt.

**Known limitation**: there is no durable delivery queue, because no
background-job infrastructure exists in this environment (spec §26/§56
explicitly scope this out rather than introducing one). If the process
restarts mid-delivery, that delivery attempt is lost — the
`WebhookDelivery` log makes gaps visible after the fact, but doesn't
recover them. The dispatch call itself never throws, so a webhook failure
can never break the approval/alert/agent-pause flow that triggered it.

## What Phase 5 deliberately doesn't do

- No Slack/Teams/PagerDuty/SIEM-specific integrations — a generic webhook
  can feed any of them.
- No per-event retry configuration, no dead-letter queue.
- No webhook endpoint editing — create, enable/disable, delete only
  (mirrors `ApiKey`'s create/revoke-only shape).
