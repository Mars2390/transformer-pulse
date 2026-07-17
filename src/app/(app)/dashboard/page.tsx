import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { roleHome } from "@/lib/session";

/**
 * /dashboard is a signpost, not a page.
 *
 * Middleware already bounces this route to the right home, so in normal use
 * nothing here renders. It exists because "the dashboard" is the link everyone
 * types, shares and bookmarks — and it must never 404 if the middleware matcher
 * is ever narrowed.
 */
export default async function DashboardRouter() {
  const user = await requireUser();
  redirect(roleHome(user.role));
}
