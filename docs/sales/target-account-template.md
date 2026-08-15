# Target account list — structure

This file defines the structure for a real target-account list. It is
deliberately **not populated** — no invented companies, contacts, or pain
hypotheses (see `AGENTS.md` §47: "do not fabricate the list inside the
application"). Populate a real CSV using these columns from actual
research (LinkedIn, company engineering blogs, job postings, conference
talks) before outreach.

## CSV columns

| Column | Description |
|---|---|
| `company` | Legal or common company name |
| `website` | Company website |
| `industry` | e.g. fintech, devtools, healthcare SaaS |
| `employee_count` | Rough headcount band |
| `ai_usage` | What you've observed publicly — a blog post, a job posting, a product feature |
| `agent_count_estimate` | Your best guess, marked as an estimate, not a fact |
| `ai_stack` | OpenAI / Anthropic / custom / framework, if known |
| `contact_name` | Primary contact |
| `contact_role` | CTO / VP Eng / Head of AI / Security Lead / etc. |
| `contact_url` | LinkedIn or similar |
| `email` | Work email, if found through legitimate means |
| `pain_hypothesis` | Your specific guess at what's painful for them — not generic |
| `status` | See pipeline stages below |
| `last_contact` | Date of most recent touch |
| `next_action` | What happens next, and by when |

## Pipeline statuses

`TARGET` → `RESEARCHED` → `CONTACTED` → `REPLIED` → `QUALIFIED` →
`DEMO` → `TRIAL` → `PILOT` → `CUSTOMER` → `LOST`

Keep it this simple — this is not a CRM (see `AGENTS.md` §10, §46, §48).

## Sourcing a real first list

Preferred sources, in order of signal quality:

1. Companies whose engineering blog or conference talk describes an AI
   agent in production (not a chatbot demo).
2. Job postings for "AI platform," "agent infrastructure," or similar
   roles — a strong signal they're scaling past one team's agent.
3. Companies using AI-native frameworks (LangGraph, CrewAI, AutoGen,
   custom orchestration) visible in open-source contributions or public
   architecture posts.
4. Warm network — portfolio companies, YC batch-mates, past colleagues at
   companies known to be building agents.

Do not scrape or purchase a generic "AI companies" list and treat it as
qualified — a wrong pain hypothesis wastes the prospect's time and yours.
