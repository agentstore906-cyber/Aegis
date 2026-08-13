import type { Metadata } from "next";
import { DemoApp } from "@/components/demo/demo-app";
import { trackEvent } from "@/lib/analytics/track";

export const metadata: Metadata = {
  title: "Live Demo",
  description:
    "Explore an interactive Aegis demo dashboard with sample agents, runs, and alerts.",
};

export default function DemoPage() {
  trackEvent("demo_opened");
  return <DemoApp />;
}
