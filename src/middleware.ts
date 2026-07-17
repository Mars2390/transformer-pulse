import { NextResponse, type NextRequest } from "next/server";
import {
  SESSION_COOKIE,
  canEnter,
  roleHome,
  verifySessionToken,
} from "@/lib/session";

/**
 * The gate.
 *
 * Runs on every matched request, in the Edge runtime, before the page does any
 * work. It only verifies the JWT signature — no database, no Prisma. That is a
 * hard constraint of the Edge runtime and also the right design: a signature
 * check is microseconds, a database round trip on every request is not.
 *
 * Important: this is a redirect layer, not the security boundary. A cookie is
 * client-controlled, so every page and API route ALSO checks the session
 * server-side via requireRole(). Middleware makes the app behave correctly;
 * requireRole() makes it safe. Never rely on this file alone.
 */

const PROTECTED = ["/admin", "/manager", "/store", "/field", "/transformers", "/dashboard"];

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const session = await verifySessionToken(
    request.cookies.get(SESSION_COOKIE)?.value,
  );

  // Already signed in and heading to /login? Send them where they belong.
  if (pathname === "/login" && session) {
    return NextResponse.redirect(new URL(roleHome(session.role), request.url));
  }

  const needsAuth = PROTECTED.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
  if (!needsAuth) return NextResponse.next();

  // Not signed in — remember where they were going, then send them to login.
  if (!session) {
    const url = new URL("/login", request.url);
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  // /dashboard is a signpost, not a page: bounce to the role's real home.
  if (pathname === "/dashboard") {
    return NextResponse.redirect(new URL(roleHome(session.role), request.url));
  }

  // Signed in, but this area is not theirs. Send them to their own dashboard
  // rather than a dead end — a field engineer hitting /admin should land
  // somewhere useful, not on a wall.
  if (!canEnter(session.role, pathname)) {
    return NextResponse.redirect(new URL(roleHome(session.role), request.url));
  }

  return NextResponse.next();
}

export const config = {
  // Skip Next internals, the API (routes guard themselves and must be able to
  // return 401 JSON rather than a redirect), and static files.
  matcher: ["/((?!api|_next/static|_next/image|images|favicon.ico|.*\\.png$).*)"],
};
