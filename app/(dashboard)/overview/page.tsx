import { redirect } from "next/navigation";

/** The Control Center lives at /agents. This URL stays so bookmarks and old links keep working. */
export default function OverviewRedirect() {
  redirect("/agents");
}
