import type { Metadata } from "next";
import Link from "next/link";

import { getCurrentUser } from "@/lib/auth/session";
import { getInvitationByToken } from "@/lib/organizations/invitations";
import { acceptInvitationAction } from "@/lib/organizations/actions"; // used by the inline "use server" action below

import { Card, CardContent } from "@/components/ui/card";
import { Button, ButtonLink } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { Logo } from "@/components/ui/logo";

export const metadata: Metadata = { title: "Accept invitation" };

export default async function AcceptInvitationPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const [invitation, user] = await Promise.all([getInvitationByToken(token), getCurrentUser()]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-surface-muted px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex justify-center">
          <Logo />
        </div>
        <Card>
          <CardContent className="space-y-4 py-6">
            {!invitation ? (
              <Alert tone="danger">This invitation link is invalid or has been revoked.</Alert>
            ) : invitation.acceptedAt ? (
              <Alert tone="info">This invitation has already been accepted.</Alert>
            ) : invitation.expiresAt <= new Date() ? (
              <Alert tone="danger">This invitation has expired. Ask an admin to send a new one.</Alert>
            ) : !user ? (
              <>
                <p className="text-sm text-foreground">
                  You&rsquo;ve been invited to join <strong>{invitation.organization.name}</strong> as{" "}
                  <strong>{invitation.role.toLowerCase()}</strong>.
                </p>
                <p className="text-sm text-muted-foreground">
                  Sign in or create an account with <strong>{invitation.email}</strong> to accept.
                </p>
                <div className="flex gap-2">
                  <ButtonLink href="/sign-in" className="flex-1 justify-center">
                    Sign in
                  </ButtonLink>
                  <ButtonLink href="/sign-up" variant="secondary" className="flex-1 justify-center">
                    Create account
                  </ButtonLink>
                </div>
              </>
            ) : user.email.toLowerCase() !== invitation.email.toLowerCase() ? (
              <>
                <Alert tone="warning">
                  This invitation was sent to {invitation.email}, but you&rsquo;re signed in as {user.email}.
                </Alert>
                <p className="text-sm text-muted-foreground">
                  Sign out and sign back in with the invited email address to accept.
                </p>
              </>
            ) : (
              <>
                <p className="text-sm text-foreground">
                  Join <strong>{invitation.organization.name}</strong> as <strong>{invitation.role.toLowerCase()}</strong>?
                </p>
                <form
                  action={async () => {
                    "use server";
                    await acceptInvitationAction(token);
                  }}
                >
                  <Button type="submit" className="w-full justify-center">
                    Accept invitation
                  </Button>
                </form>
              </>
            )}
            <p className="pt-2 text-center text-xs text-muted-foreground">
              <Link href="/" className="hover:underline">
                Back to Aegis
              </Link>
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
