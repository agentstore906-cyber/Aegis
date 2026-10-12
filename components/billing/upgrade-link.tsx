/**
 * "Upgrade" for a user who might not be allowed to open it. Pass `canUpgrade={canAccessUpgradePage(role)}`
 * (lib/billing/authorization.ts): roles that cannot open /upgrade get a pointer to who can, never a link to a 404.
 */
export function UpgradeLink({ canUpgrade, suffix = "for more." }: { canUpgrade: boolean; suffix?: string }) {
  if (!canUpgrade) return <>Ask a workspace owner or admin to upgrade {suffix}</>;
  return (
    <>
      <a href="/upgrade" className="underline">
        Upgrade
      </a>{" "}
      {suffix}
    </>
  );
}
