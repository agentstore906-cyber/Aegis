import { Hero } from "@/components/marketing/hero";
import { ProblemSection } from "@/components/marketing/problem-section";
import { ControlPlaneSection } from "@/components/marketing/control-plane-section";
import { ActivityPreviewSection } from "@/components/marketing/activity-preview-section";
import { PoliciesPreviewSection } from "@/components/marketing/policies-preview-section";
import { ApprovalsPreviewSection } from "@/components/marketing/approvals-preview-section";
import { SecurityPreviewSection } from "@/components/marketing/security-preview-section";
import { CostPreviewSection } from "@/components/marketing/cost-preview-section";
import { CtaSection } from "@/components/marketing/cta-section";

export default function HomePage() {
  return (
    <>
      <Hero />
      <ProblemSection />
      <ControlPlaneSection />
      <ActivityPreviewSection />
      <PoliciesPreviewSection />
      <ApprovalsPreviewSection />
      <SecurityPreviewSection />
      <CostPreviewSection />
      <CtaSection />
    </>
  );
}
