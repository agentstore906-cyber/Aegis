import type { MetadataRoute } from "next";
import { getSiteUrl } from "@/lib/seo";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: [
          "/api/",
          "/overview",
          "/agents",
          "/activity",
          "/policies",
          "/approvals",
          "/security/",
          "/costs",
          "/audit",
          "/integrations",
          "/developers",
          "/settings/",
          "/onboarding",
          "/invitations/",
        ],
      },
    ],
    sitemap: `${getSiteUrl()}/sitemap.xml`,
  };
}
