# RBAC (Phase 5)

`lib/rbac/capabilities.ts` is the single source of truth for "what can
this role do." Every domain's authorization file delegates to
`hasCapability(role, capability)` rather than comparing roles itself.

## Roles

`OWNER`, `ADMIN`, `ENGINEER`, `SECURITY`, `FINANCE`, `VIEWER` (`FINANCE` is
new in Phase 5). Fixed, not admin-editable — there is no custom-role
builder (spec §17 explicitly asks for a role → capability map, not a
builder UI).

## Capability table

| Capability | OWNER | ADMIN | ENGINEER | SECURITY | FINANCE | VIEWER |
|---|---|---|---|---|---|---|
| `manage_agents` | ✅ | ✅ | ✅ | ✅ | | |
| `manage_policies` | ✅ | ✅ | | ✅ | | |
| `manage_permissions` | ✅ | ✅ | ✅ | ✅ | | |
| `resolve_approvals` | ✅ | ✅ | | ✅ | | |
| `view_security` | ✅ | ✅ | ✅ | ✅ | | ✅ |
| `resolve_security` | ✅ | ✅ | | ✅ | | |
| `view_costs` | ✅ | ✅ | ✅ | | ✅ | ✅ |
| `manage_api_keys` | ✅ | ✅ | | | | |
| `view_audit` | ✅ | ✅ | ✅ | ✅ | ✅ | |
| `manage_members` | ✅ | ✅ | | | | |
| `manage_webhooks` | ✅ | ✅ | | | | |

Notable calls:

- **`SECURITY` has `manage_agents`.** Not a typo — the "Pause agent"
  action on a Security Alert's detail page has to actually work (spec
  §15: "If you expose 'Pause agent,' it must actually work"), so the role
  that resolves security alerts needs the capability that action requires.
- **`FINANCE` does not have `view_security`.** A deliberate scope choice —
  Finance needs cost visibility and the audit trail, not behavioral
  security data. (Confirmed as the intended design, not an oversight —
  see the test in `lib/security/__tests__/authorization.test.ts`.)
- **Plain "view" access to Policies, Approvals, and Policy Evaluations is
  not a capability at all.** That's been unconditionally available to
  every organization member (including `VIEWER`) since Phase 2/3
  (`canViewApprovals()`, `canViewPolicyEvaluations()`), and stays
  unchanged — the capability map only covers surfaces that actually
  differ by role.

## Privilege escalation guards (spec §24)

Granting, changing, or removing the `OWNER` role requires the *acting*
member to already be an `OWNER` — an `ADMIN` cannot promote itself or
anyone else to `OWNER`, nor demote one. An organization can never end up
with zero `OWNER`s: `lib/organizations/members.ts#changeMemberRole` /
`#removeMember` both check the current owner count inside the same
transaction as the mutation. `LastOwnerError` / `PrivilegeEscalationError`
are thrown for the UI to surface as a validation message, never silently
ignored.

## Member invitations

No email is sent — there is no mail provider in this codebase. Inviting a
member creates an `OrganizationInvitation` row with a random token; the
inviter copies the generated `/invitations/<token>` link and shares it
however they choose. The accept page (`app/invitations/[token]/page.tsx`)
requires the signed-in user's email to match the invitation's email
before showing an Accept button — a leaked link alone isn't enough to
join.

## Adding a new capability

1. Add the string to `CAPABILITIES` in `lib/rbac/capabilities.ts`.
2. Add it to the relevant roles in `ROLE_CAPABILITIES`.
3. Add a `can<Thing>(role)` wrapper in the owning domain's
   `authorization.ts` (or use `hasCapability` directly) — call it from
   both the Server Action and the page loader, never trust hidden UI
   alone.
