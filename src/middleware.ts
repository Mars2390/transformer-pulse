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
 * work. It verifies the cookie's signature and nothing else — no database, no
 * Prisma. That is a hard constraint of the Edge runtime, and also the right
 * design: a signature check is microseconds; a database round trip on every
 * request is not.
 *
 * IMPORTANT: this is a redirect layer, not the security boundary. A cookie is
 * client-controlled, so every page and API route ALSO checks the session
 * server-side via requireRole(). Middleware makes the app behave correctly;
 * requireRole() makes it safe. Never rely on this file alone.
 */

const PROTECTED = ["/admin", "/manager", "/store", "/field", "/transformers", "/dashboard", "/kplc-control"];

function isProtected(pathname: string): boolean {
  return PROTECTED.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  try {
    const session = await verifySessionToken(
      request.cookies.get(SESSION_COOKIE)?.value,
    );

    // Already signed in and heading to /login? Send them where they belong.
    if (pathname === "/login" && session) {
      return NextResponse.redirect(new URL(roleHome(session.role), request.url));
    }

    if (!isProtected(pathname)) return NextResponse.next();

    // Not signed in — remember where they were going, then send them to login.
    if (!session) {
      const url = new URL("/login", request.url);
      url.searchParams.set("next", pathname);
      return NextResponse.redirect(url);
    }

    // /dashboard is a signpost, not a page.
    if (pathname === "/dashboard") {
      return NextResponse.redirect(new URL(roleHome(session.role), request.url));
    }

    // Signed in, but this area is not theirs. Send them to their own dashboard
    // rather than a dead end.
    if (!canEnter(session.role, pathname)) {
      return NextResponse.redirect(new URL(roleHome(session.role), request.url));
    }

    return NextResponse.next();
  } catch (error) {
    // A throw in Edge middleware returns MIDDLEWARE_INVOCATION_FAILED for the
    // WHOLE SITE — the landing page included, which needs no session at all.
    // That is never an acceptable outcome for a bug in an auth hint.
    //
    // So: log it, then fail SAFE rather than open. Protected routes go to the
    // login page; public routes carry on. The layout's requireRole() is still
    // the real boundary, so nothing private can leak through this path.
    console.error("Middleware error:", error);

    if (isProtected(pathname)) {
      return NextResponse.redirect(new URL("/login", request.url));
    }
    return NextResponse.next();
  }
}

export const config = {
  // Skip Next internals, the API (routes guard themselves, and must return 401
  // JSON rather than a redirect), and static files.
  matcher: ["/((?!api|_next/static|_next/image|images|favicon.ico|.*\\.png$).*)"],
};
