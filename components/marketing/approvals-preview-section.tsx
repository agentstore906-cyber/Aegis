import { PreviewLabel } from "@/components/marketing/preview-label";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export function ApprovalsPreviewSection() {
  return (
    <section className="border-t border-border bg-surface-muted">
      <div className="mx-auto max-w-6xl px-6 py-20">
        <div className="grid gap-10 lg:grid-cols-2 lg:items-center lg:gap-16">
          <div className="order-2 rounded-xl border border-border bg-surface p-5 lg:order-1">
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium uppercase tracking-wide text-warning">
                Approval required
              </p>
              <span className="text-xs text-muted-foreground">Requested 32s ago</span>
            </div>
            <p className="mt-3 text-base font-semibold text-foreground">Finance Agent</p>
            <dl className="mt-3 space-y-2 text-sm">
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Action</dt>
                <dd className="text-foreground">Issue refund</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Amount</dt>
                <dd className="font-medium text-foreground">$1,250</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Customer</dt>
                <dd className="text-foreground">Acme Inc.</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Reason</dt>
                <dd className="text-foreground">Customer cancellation</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Risk</dt>
                <dd>
                  <Badge tone="danger">High</Badge>
                </dd>
              </div>
            </dl>
            <div className="mt-5 flex gap-2">
              <Button variant="secondary" size="sm" className="flex-1" disabled>
                Reject
              </Button>
              <Button variant="primary" size="sm" className="flex-1" disabled>
                Approve
              </Button>
            </div>
          </div>

          <div className="order-1 lg:order-2">
            <PreviewLabel>Coming next — Approvals</PreviewLabel>
            <h2 className="mt-4 text-3xl font-semibold tracking-tight text-foreground">
              Autonomous when safe. Human when it matters.
            </h2>
            <p className="mt-4 text-muted-foreground">
              Sensitive actions pause automatically until an authorized person
              approves or rejects them — with full context on why the action was
              flagged.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
