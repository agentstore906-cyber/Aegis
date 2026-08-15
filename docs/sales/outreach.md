# Outbound templates

Short, specific, problem-focused, personalizable. Never claim a customer,
metric, or partnership that doesn't exist (see `AGENTS.md` §0). Fill in
the bracketed specifics from real research on the account
(`docs/sales/target-account-template.md`) before sending — a template sent
unedited is spam.

## CTO

> Subject: How are you governing [Company]'s AI agents in production?
>
> Hi [Name] — noticed [specific signal: job post for an AI platform role /
> a blog post about an agent workflow / a public mention of an agent
> shipping]. Quick question: as [Company]'s agents touch [CRM / prod
> infra / customer data], who has visibility into what they're actually
> doing, and who signs off on the sensitive actions?
>
> We built Aegis to answer that — a control plane that sits between an
> agent and the action it's about to take: policy, human approval on
> anything sensitive, and an audit trail, without executing anything
> itself. Worth 15 minutes to see if it's relevant to what you're running?

## Head of AI / AI Engineering Lead

> Subject: Agent governance for [Company]
>
> Hi [Name] — you're building [specific: the support agent / the coding
> agent] at [Company]. As that moves toward production, how are you
> handling the case where it wants to do something risky — a refund, a
> deploy, a bulk export?
>
> Aegis gives an agent process a call to make (`aegis.authorize(...)`)
> before it acts — allow, block, or route to a human — plus the activity
> log and policy history to back it up. No framework lock-in, works with
> whatever you're running today. Open to a look?

## VP Engineering

> Subject: Production governance for [Company]'s AI agents
>
> Hi [Name] — as [Company] puts more of the workforce's work through AI
> agents, the reliability/governance question usually lands on your desk
> eventually: who approved that, what did the agent actually do, what's
> it costing. Aegis centralizes that — policy engine, approvals, audit,
> cost tracking — across every agent, not one integration per team.
>
> Happy to send a 15-minute walkthrough, or you can look yourself first:
> [link to /demo].

## Security Lead

> Subject: AI agent permissions at [Company]
>
> Hi [Name] — AI agents at [Company] can [read customer data / call
> internal APIs / touch prod]. If one does something unexpected — a bulk
> export, a repeated failed action, a first-ever high-risk call — is
> there anything that flags it automatically, or does someone have to
> notice?
>
> Aegis runs deterministic behavioral detectors (not a black-box score)
> on every agent action and routes sensitive ones through human approval
> before they execute. Worth a look at how it'd sit in your stack?

## AI Engineer (developer-first entry point)

> Subject: A control layer for the agent you're shipping
>
> Hey [Name] — saw [specific: repo / post / talk] about the agent you're
> building. If it touches anything sensitive, `@aegis/agent-sdk` gives it
> an `authorize()` call before it acts, with `ALLOW`/`BLOCK`/
> `REQUIRE_APPROVAL` as a typed result. Free to try, no sales call needed:
> [link to /developers/quickstart]. Curious what you think.

## Follow-up sequence

1. **Message 1** — as above.
2. **Follow-up 1** (4–5 business days later) — add one concrete thing:
   a link to the demo, a specific use case relevant to their stack, or a
   short answer to a question they might have. Don't just "bump this."
3. **Follow-up 2** (about a week after that) — different angle, e.g. the
   security-detector angle if the first message was about approvals, or
   vice versa. Still short.
4. **Final follow-up** — explicit permission to close the loop: "I'll
   leave this here — reach out if AI agent governance becomes a priority."
   No guilt, no fake urgency, no "just following up" with nothing new.

Never send more than 4 touches without a reply. Respect unsubscribes and
"not now" immediately.
