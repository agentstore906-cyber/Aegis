import type { MetadataRoute } from "next";
import { getSiteUrl } from "@/lib/seo";

const PUBLIC_ROUTES = [
  "",
  "/pricing",
  "/trust",
  "/contact",
  "/privacy",
  "/terms",
  "/docs",
  "/docs/policies",
  "/docs/approvals",
  "/docs/security",
  "/docs/billing",
  "/docs/deployment",
  "/docs/api",
  "/docs/sdk",
  "/demo",
  "/sign-in",
  "/sign-up",
];

export default function sitemap(): MetadataRoute.Sitemap {
  const siteUrl = getSiteUrl();
  return PUBLIC_ROUTES.map((route) => ({
    url: `${siteUrl}${route}`,
    lastModified: new Date(),
  }));
}
